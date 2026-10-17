import { beforeEach, describe, expect, it, vi } from "vitest";
import { createKheopskitStore } from "../api/store";
import { parseCookie, type SyncableStorage } from "../utils/storage";
import type { WalletId } from "../utils/WalletId";
import type { KheopskitStoreData } from "./types";

describe("createKheopskitStore", () => {
	const STORAGE_KEY = "kheopskit";

	beforeEach(() => {
		localStorage.clear();
		// Clear cookies
		document.cookie.split(";").forEach((c) => {
			const name = c.split("=")[0]?.trim();
			if (name) {
				// biome-ignore lint/suspicious/noDocumentCookie: necessary for test cleanup
				document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:01 GMT;path=/`;
			}
		});
	});

	describe("without ssrCookies (localStorage mode)", () => {
		it("creates a store with empty remembered list by default", () => {
			const kstore = createKheopskitStore();
			const values: { remembered?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));
			expect(values[0]).toEqual({});
			sub.unsubscribe();
		});

		it("reads existing data from localStorage", () => {
			const existingData = {
				remembered: ["polkadot:talisman"] as WalletId[],
			};
			localStorage.setItem(STORAGE_KEY, JSON.stringify(existingData));

			const kstore = createKheopskitStore();
			const values: { remembered?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));
			expect(values[0]).toEqual(existingData);
			sub.unsubscribe();
		});

		it("rememberWallet adds wallet to remembered", () => {
			const kstore = createKheopskitStore();
			const walletId = "polkadot:polkadot-js" as WalletId;

			kstore.rememberWallet(walletId);

			const values: { remembered?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));
			expect(values[0]?.remembered).toContain(walletId);
			sub.unsubscribe();
		});

		it("rememberWallet does not duplicate wallets", () => {
			const kstore = createKheopskitStore();
			const walletId = "polkadot:subwallet-js" as WalletId;

			kstore.rememberWallet(walletId);
			kstore.rememberWallet(walletId);
			kstore.rememberWallet(walletId);

			const values: { remembered?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));
			const count = values[0]?.remembered?.filter(
				(id) => id === walletId,
			).length;
			expect(count).toBe(1);
			sub.unsubscribe();
		});

		it("rememberWallet validates wallet ID format", () => {
			const kstore = createKheopskitStore();

			// Invalid wallet IDs should throw
			expect(() => kstore.rememberWallet("invalid" as WalletId)).toThrow();
			expect(() => kstore.rememberWallet("" as WalletId)).toThrow();
		});

		it("forgetWallet removes wallet from remembered", () => {
			const existingData = {
				remembered: ["polkadot:talisman", "polkadot:polkadot-js"] as WalletId[],
			};
			localStorage.setItem(STORAGE_KEY, JSON.stringify(existingData));

			const kstore = createKheopskitStore();
			kstore.forgetWallet("polkadot:talisman" as WalletId);

			const values: { remembered?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));
			expect(values[0]?.remembered).not.toContain("polkadot:talisman");
			expect(values[0]?.remembered).toContain("polkadot:polkadot-js");
			sub.unsubscribe();
		});

		it("forgetWallet handles removing non-existent wallet", () => {
			const kstore = createKheopskitStore();

			// Should not throw when removing wallet that doesn't exist
			expect(() =>
				kstore.forgetWallet("polkadot:nonexistent" as WalletId),
			).not.toThrow();
		});

		it("migrates a legacy autoReconnect list on first read and rewrites it as remembered", () => {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ autoReconnect: ["polkadot:talisman"] }),
			);

			const kstore = createKheopskitStore();
			const values: KheopskitStoreData[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));
			expect(values[0]).toEqual({ remembered: ["polkadot:talisman"] });
			sub.unsubscribe();

			kstore.setCachedState([], []);

			expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({
				remembered: ["polkadot:talisman"],
				cachedWallets: [],
				cachedAccounts: [],
			});
		});

		it("migrates a legacy autoReconnect list received from another tab", () => {
			const kstore = createKheopskitStore();
			const values: KheopskitStoreData[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));

			window.dispatchEvent(
				new StorageEvent("storage", {
					key: STORAGE_KEY,
					newValue: JSON.stringify({ autoReconnect: ["polkadot:talisman"] }),
				}),
			);

			expect(values.at(-1)).toEqual({ remembered: ["polkadot:talisman"] });
			sub.unsubscribe();
		});

		it("createKheopskitStore uses the given storage and destroy stops storage sync", () => {
			const entries = new Map([
				[STORAGE_KEY, JSON.stringify({ remembered: ["polkadot:talisman"] })],
			]);
			const unsubscribe = vi.fn();
			let pushFromOtherTab: (value: string | null) => void = () => {};
			const storage = {
				getItem: vi.fn((key: string) => entries.get(key) ?? null),
				setItem: vi.fn((key: string, value: string) => {
					entries.set(key, value);
				}),
				removeItem: vi.fn(),
				subscribe: vi.fn(
					(_key: string, callback: (value: string | null) => void) => {
						pushFromOtherTab = callback;
						return unsubscribe;
					},
				),
			} satisfies SyncableStorage;

			const kstore = createKheopskitStore({ storage, ssrCookies: "" });
			const values: KheopskitStoreData[] = [];
			kstore.observable.subscribe((v) => values.push(v));
			expect(values).toEqual([{ remembered: ["polkadot:talisman"] }]);

			kstore.rememberWallet("polkadot:polkadot-js" as WalletId);
			expect(storage.setItem).toHaveBeenCalledWith(
				STORAGE_KEY,
				JSON.stringify({
					remembered: ["polkadot:talisman", "polkadot:polkadot-js"],
				}),
			);
			expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
			expect(parseCookie(document.cookie, STORAGE_KEY)).toBeNull();

			pushFromOtherTab(JSON.stringify({ remembered: [] }));
			expect(values).toHaveLength(3);

			kstore.destroy();
			expect(unsubscribe).toHaveBeenCalledOnce();
			pushFromOtherTab(JSON.stringify({ remembered: ["solana:Phantom"] }));
			expect(values).toHaveLength(3);
		});

		it("persists changes to localStorage", () => {
			const kstore = createKheopskitStore();
			kstore.rememberWallet("ethereum:metamask" as WalletId);

			const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
			expect(stored.remembered).toContain("ethereum:metamask");
		});
	});

	describe("with ssrCookies (cookie mode)", () => {
		it("creates a store using cookie storage", () => {
			const existingData = {
				remembered: ["polkadot:talisman"] as WalletId[],
			};
			const ssrCookies = `${STORAGE_KEY}=${encodeURIComponent(JSON.stringify(existingData))}`;

			const kstore = createKheopskitStore({ ssrCookies });
			// Store is created successfully
			expect(kstore.observable).toBeDefined();
			expect(kstore.rememberWallet).toBeDefined();
			expect(kstore.forgetWallet).toBeDefined();
		});

		it("rememberWallet works with cookie storage", () => {
			const kstore = createKheopskitStore({ ssrCookies: "" }); // Empty cookies, uses cookie storage
			kstore.rememberWallet("polkadot:polkadot-js" as WalletId);

			// Should persist to cookies (verify via observable since document.cookie in jsdom may be cleared)
			const values: { remembered?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));
			expect(values[0]?.remembered).toContain("polkadot:polkadot-js");
			sub.unsubscribe();
		});

		it("forgetWallet works with cookie storage", () => {
			// Pre-populate with a cookie
			const existingData = {
				remembered: ["polkadot:talisman"] as WalletId[],
			};
			// biome-ignore lint/suspicious/noDocumentCookie: necessary for test setup
			document.cookie = `${STORAGE_KEY}=${encodeURIComponent(JSON.stringify(existingData))};path=/`;

			const kstore = createKheopskitStore();
			kstore.forgetWallet("polkadot:talisman" as WalletId);

			const values: { remembered?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));
			expect(values[0]?.remembered).not.toContain("polkadot:talisman");
			sub.unsubscribe();
		});

		it("preserves polkadotAccountType in compact cookie storage", () => {
			const kstore = createKheopskitStore({ ssrCookies: "" });
			kstore.setCachedState(
				[
					{
						id: "polkadot:talisman" as WalletId,
						platform: "polkadot",
						type: "injected",
						name: "Talisman",
						isConnected: true,
					},
				],
				[
					{
						id: "polkadot:talisman::5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
						platform: "polkadot",
						address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
						polkadotAccountType: "ethereum",
						walletId: "polkadot:talisman" as WalletId,
						walletName: "Talisman",
					},
				],
			);

			const kstoreReloaded = createKheopskitStore({
				ssrCookies: document.cookie,
			});
			const cached = kstoreReloaded.getCachedState();

			expect(cached.accounts).toHaveLength(1);
			expect(cached.accounts[0]?.polkadotAccountType).toBe("ethereum");
		});

		it("reads legacy compact account entries without polkadotAccountType", () => {
			const legacyCompact = {
				v: 1,
				w: [["polkadot:talisman", "Talisman", 1, 0]],
				a: [
					[
						"polkadot:talisman",
						"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
						null,
						null,
					],
				],
			};
			// biome-ignore lint/suspicious/noDocumentCookie: necessary for test setup
			document.cookie = `${STORAGE_KEY}=${encodeURIComponent(JSON.stringify(legacyCompact))};path=/`;

			const kstore = createKheopskitStore({ ssrCookies: document.cookie });
			const cached = kstore.getCachedState();

			expect(cached.accounts).toHaveLength(1);
			expect(cached.accounts[0]?.polkadotAccountType).toBeUndefined();
		});
	});

	describe("cookie mode remembered list", () => {
		const readRemembered = (
			kstore: ReturnType<typeof createKheopskitStore>,
		) => {
			const values: KheopskitStoreData[] = [];
			kstore.observable.subscribe((v) => values.push(v)).unsubscribe();
			return values[0]?.remembered;
		};
		const readCompactCookie = () =>
			JSON.parse(parseCookie(document.cookie, STORAGE_KEY) ?? "null");

		it("cookie mode round-trips remembered under the compact key", () => {
			// biome-ignore lint/suspicious/noDocumentCookie: necessary for test setup
			document.cookie = `${STORAGE_KEY}=${encodeURIComponent(JSON.stringify({ v: 1, r: ["polkadot:talisman"] }))};path=/`;

			const kstore = createKheopskitStore({ ssrCookies: document.cookie });
			expect(readRemembered(kstore)).toEqual(["polkadot:talisman"]);

			kstore.rememberWallet("ethereum:metamask" as WalletId);
			expect(readCompactCookie()).toEqual({
				v: 1,
				r: ["polkadot:talisman", "ethereum:metamask"],
			});

			const reloaded = createKheopskitStore({ ssrCookies: document.cookie });
			expect(readRemembered(reloaded)).toEqual([
				"polkadot:talisman",
				"ethereum:metamask",
			]);
		});

		it("keeps the list of a legacy verbose autoReconnect cookie", () => {
			// biome-ignore lint/suspicious/noDocumentCookie: necessary for test setup
			document.cookie = `${STORAGE_KEY}=${encodeURIComponent(JSON.stringify({ autoReconnect: ["polkadot:talisman"] }))};path=/`;

			const kstore = createKheopskitStore({ ssrCookies: document.cookie });

			expect(readRemembered(kstore)).toEqual(["polkadot:talisman"]);
			expect(readCompactCookie()).toMatchObject({
				v: 1,
				r: ["polkadot:talisman"],
			});
		});
	});

	describe("tolerates malformed / legacy cached state", () => {
		const validWallet = {
			id: "polkadot:talisman",
			platform: "polkadot",
			type: "injected",
			name: "Talisman",
			isConnected: false,
		};
		const validAccount = {
			id: "polkadot:talisman:5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
			platform: "polkadot",
			address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
			polkadotAccountType: "sr25519",
			walletId: "polkadot:talisman",
			walletName: "Talisman",
		};

		it("drops cached wallets with an invalid id but keeps valid ones", () => {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({
					cachedWallets: [
						{ ...validWallet, id: "garbage" },
						{ ...validWallet, id: "unknownplatform:foo" },
						validWallet,
					],
				}),
			);

			const cached = createKheopskitStore().getCachedState();
			expect(cached.wallets).toHaveLength(1);
			expect(cached.wallets[0]?.id).toBe("polkadot:talisman");
		});

		it("drops cached wallets/accounts missing required fields", () => {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({
					cachedWallets: [
						{ id: "polkadot:talisman" }, // missing name/type/isConnected
						null,
						"nope",
					],
					cachedAccounts: [
						{ ...validAccount, walletName: undefined }, // missing walletName
						{ ...validAccount, walletId: "bad" }, // invalid walletId
					],
				}),
			);

			const cached = createKheopskitStore().getCachedState();
			expect(cached.wallets).toHaveLength(0);
			expect(cached.accounts).toHaveLength(0);
		});

		it("keeps fully-valid cached wallets and accounts", () => {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({
					cachedWallets: [validWallet],
					cachedAccounts: [validAccount],
				}),
			);

			const cached = createKheopskitStore().getCachedState();
			expect(cached.wallets).toHaveLength(1);
			expect(cached.accounts).toHaveLength(1);
		});

		it("returns empty when cached fields are not arrays", () => {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ cachedWallets: "oops", cachedAccounts: { a: 1 } }),
			);

			const cached = createKheopskitStore().getCachedState();
			expect(cached.wallets).toEqual([]);
			expect(cached.accounts).toEqual([]);
		});

		it.each(["null", "[]", "42", '"a string"'])(
			"does not throw when the stored value is %s",
			(raw) => {
				localStorage.setItem(STORAGE_KEY, raw);

				const kstore = createKheopskitStore();
				expect(() => kstore.getCachedState()).not.toThrow();
				expect(kstore.getCachedState().wallets).toEqual([]);
			},
		);

		it("ignores data that only has a remembered list", () => {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ remembered: ["polkadot:talisman"], legacyKey: 1 }),
			);

			const cached = createKheopskitStore().getCachedState();
			expect(cached.wallets).toEqual([]);
			expect(cached.accounts).toEqual([]);
		});

		it("does not throw on a malformed compact cookie and drops bad entries", () => {
			const malformedCompact = {
				v: 1,
				w: [
					["garbage", "Nope", 1, 0],
					[123, "WrongType", 1, 0],
					["polkadot:talisman", "Talisman", 1, 0],
				],
				a: [
					["bad-wallet-id", "addr", null, null],
					[
						"polkadot:talisman",
						"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
						null,
						null,
					],
				],
			};
			// biome-ignore lint/suspicious/noDocumentCookie: necessary for test setup
			document.cookie = `${STORAGE_KEY}=${encodeURIComponent(JSON.stringify(malformedCompact))};path=/`;

			let kstore!: ReturnType<typeof createKheopskitStore>;
			expect(() => {
				kstore = createKheopskitStore({ ssrCookies: document.cookie });
			}).not.toThrow();

			const cached = kstore.getCachedState();
			expect(cached.wallets).toHaveLength(1);
			expect(cached.wallets[0]?.id).toBe("polkadot:talisman");
			expect(cached.accounts).toHaveLength(1);
		});
	});

	describe("observable behavior", () => {
		it("emits initial value immediately", () => {
			const kstore = createKheopskitStore();
			let emitCount = 0;
			const sub = kstore.observable.subscribe(() => emitCount++);
			expect(emitCount).toBe(1);
			sub.unsubscribe();
		});

		it("emits on rememberWallet", () => {
			const kstore = createKheopskitStore();
			const values: { remembered?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));

			kstore.rememberWallet("polkadot:polkadot-js" as WalletId);

			expect(values.length).toBe(2);
			sub.unsubscribe();
		});

		it("emits on forgetWallet", () => {
			const existingData = {
				remembered: ["polkadot:talisman"] as WalletId[],
			};
			localStorage.setItem(STORAGE_KEY, JSON.stringify(existingData));

			const kstore = createKheopskitStore();
			const values: { remembered?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));

			kstore.forgetWallet("polkadot:talisman" as WalletId);

			expect(values.length).toBe(2);
			sub.unsubscribe();
		});
	});

	describe("multiple stores independence", () => {
		it("stores created without ssrCookies share localStorage", () => {
			const store1 = createKheopskitStore();
			// store2 not used but demonstrates multiple stores can be created
			createKheopskitStore();

			store1.rememberWallet("polkadot:talisman" as WalletId);

			// store2 won't see the update automatically (no cross-instance sync)
			// but localStorage is shared
			const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
			expect(stored.remembered).toContain("polkadot:talisman");
		});
	});
});

describe("wallet ID combinations", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	const validWalletIds: WalletId[] = [
		"polkadot:polkadot-js" as WalletId,
		"polkadot:talisman" as WalletId,
		"polkadot:subwallet-js" as WalletId,
		"ethereum:metamask" as WalletId,
	];

	it("handles multiple different wallet IDs", () => {
		const kstore = createKheopskitStore();

		for (const walletId of validWalletIds) {
			kstore.rememberWallet(walletId);
		}

		const values: { remembered?: WalletId[] }[] = [];
		const sub = kstore.observable.subscribe((v) => values.push(v));

		expect(values[0]?.remembered).toHaveLength(validWalletIds.length);
		for (const walletId of validWalletIds) {
			expect(values[0]?.remembered).toContain(walletId);
		}
		sub.unsubscribe();
	});

	it("handles adding and removing in sequence", () => {
		const kstore = createKheopskitStore();

		// Add all
		for (const walletId of validWalletIds) {
			kstore.rememberWallet(walletId);
		}

		// Remove half
		const [first, second] = validWalletIds;
		if (first) kstore.forgetWallet(first);
		if (second) kstore.forgetWallet(second);
		const values: { remembered?: WalletId[] }[] = [];
		const sub = kstore.observable.subscribe((v) => values.push(v));

		expect(values[0]?.remembered).toHaveLength(2);
		expect(values[0]?.remembered).not.toContain(validWalletIds[0]);
		expect(values[0]?.remembered).not.toContain(validWalletIds[1]);
		expect(values[0]?.remembered).toContain(validWalletIds[2]);
		expect(values[0]?.remembered).toContain(validWalletIds[3]);
		sub.unsubscribe();
	});
});
