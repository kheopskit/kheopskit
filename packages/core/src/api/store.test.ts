import { beforeEach, describe, expect, it } from "vitest";
import { createKheopskitStore, store } from "../api/store";
import type { WalletId } from "../utils/WalletId";

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
		it("creates a store with empty autoReconnect by default", () => {
			const kstore = createKheopskitStore();
			const values: { autoReconnect?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));
			expect(values[0]).toEqual({});
			sub.unsubscribe();
		});

		it("reads existing data from localStorage", () => {
			const existingData = {
				autoReconnect: ["polkadot:talisman"] as WalletId[],
			};
			localStorage.setItem(STORAGE_KEY, JSON.stringify(existingData));

			const kstore = createKheopskitStore();
			const values: { autoReconnect?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));
			expect(values[0]).toEqual(existingData);
			sub.unsubscribe();
		});

		it("addEnabledWalletId adds wallet to autoReconnect", () => {
			const kstore = createKheopskitStore();
			const walletId = "polkadot:polkadot-js" as WalletId;

			kstore.addEnabledWalletId(walletId);

			const values: { autoReconnect?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));
			expect(values[0]?.autoReconnect).toContain(walletId);
			sub.unsubscribe();
		});

		it("addEnabledWalletId does not duplicate wallets", () => {
			const kstore = createKheopskitStore();
			const walletId = "polkadot:subwallet-js" as WalletId;

			kstore.addEnabledWalletId(walletId);
			kstore.addEnabledWalletId(walletId);
			kstore.addEnabledWalletId(walletId);

			const values: { autoReconnect?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));
			const count = values[0]?.autoReconnect?.filter(
				(id) => id === walletId,
			).length;
			expect(count).toBe(1);
			sub.unsubscribe();
		});

		it("addEnabledWalletId validates wallet ID format", () => {
			const kstore = createKheopskitStore();

			// Invalid wallet IDs should throw
			expect(() => kstore.addEnabledWalletId("invalid" as WalletId)).toThrow();
			expect(() => kstore.addEnabledWalletId("" as WalletId)).toThrow();
		});

		it("removeEnabledWalletId removes wallet from autoReconnect", () => {
			const existingData = {
				autoReconnect: [
					"polkadot:talisman",
					"polkadot:polkadot-js",
				] as WalletId[],
			};
			localStorage.setItem(STORAGE_KEY, JSON.stringify(existingData));

			const kstore = createKheopskitStore();
			kstore.removeEnabledWalletId("polkadot:talisman" as WalletId);

			const values: { autoReconnect?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));
			expect(values[0]?.autoReconnect).not.toContain("polkadot:talisman");
			expect(values[0]?.autoReconnect).toContain("polkadot:polkadot-js");
			sub.unsubscribe();
		});

		it("removeEnabledWalletId handles removing non-existent wallet", () => {
			const kstore = createKheopskitStore();

			// Should not throw when removing wallet that doesn't exist
			expect(() =>
				kstore.removeEnabledWalletId("polkadot:nonexistent" as WalletId),
			).not.toThrow();
		});

		it("persists changes to localStorage", () => {
			const kstore = createKheopskitStore();
			kstore.addEnabledWalletId("ethereum:metamask" as WalletId);

			const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
			expect(stored.autoReconnect).toContain("ethereum:metamask");
		});
	});

	describe("with ssrCookies (cookie mode)", () => {
		it("creates a store using cookie storage", () => {
			const existingData = {
				autoReconnect: ["polkadot:talisman"] as WalletId[],
			};
			const ssrCookies = `${STORAGE_KEY}=${encodeURIComponent(JSON.stringify(existingData))}`;

			const kstore = createKheopskitStore({ ssrCookies });
			// Store is created successfully
			expect(kstore.observable).toBeDefined();
			expect(kstore.addEnabledWalletId).toBeDefined();
			expect(kstore.removeEnabledWalletId).toBeDefined();
		});

		it("addEnabledWalletId works with cookie storage", () => {
			const kstore = createKheopskitStore({ ssrCookies: "" }); // Empty cookies, uses cookie storage
			kstore.addEnabledWalletId("polkadot:polkadot-js" as WalletId);

			// Should persist to cookies (verify via observable since document.cookie in jsdom may be cleared)
			const values: { autoReconnect?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));
			expect(values[0]?.autoReconnect).toContain("polkadot:polkadot-js");
			sub.unsubscribe();
		});

		it("removeEnabledWalletId works with cookie storage", () => {
			// Pre-populate with a cookie
			const existingData = {
				autoReconnect: ["polkadot:talisman"] as WalletId[],
			};
			// biome-ignore lint/suspicious/noDocumentCookie: necessary for test setup
			document.cookie = `${STORAGE_KEY}=${encodeURIComponent(JSON.stringify(existingData))};path=/`;

			const kstore = createKheopskitStore();
			kstore.removeEnabledWalletId("polkadot:talisman" as WalletId);

			const values: { autoReconnect?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));
			expect(values[0]?.autoReconnect).not.toContain("polkadot:talisman");
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

	describe("observable behavior", () => {
		it("emits initial value immediately", () => {
			const kstore = createKheopskitStore();
			let emitCount = 0;
			const sub = kstore.observable.subscribe(() => emitCount++);
			expect(emitCount).toBe(1);
			sub.unsubscribe();
		});

		it("emits on addEnabledWalletId", () => {
			const kstore = createKheopskitStore();
			const values: { autoReconnect?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));

			kstore.addEnabledWalletId("polkadot:polkadot-js" as WalletId);

			expect(values.length).toBe(2);
			sub.unsubscribe();
		});

		it("emits on removeEnabledWalletId", () => {
			const existingData = {
				autoReconnect: ["polkadot:talisman"] as WalletId[],
			};
			localStorage.setItem(STORAGE_KEY, JSON.stringify(existingData));

			const kstore = createKheopskitStore();
			const values: { autoReconnect?: WalletId[] }[] = [];
			const sub = kstore.observable.subscribe((v) => values.push(v));

			kstore.removeEnabledWalletId("polkadot:talisman" as WalletId);

			expect(values.length).toBe(2);
			sub.unsubscribe();
		});
	});

	describe("multiple stores independence", () => {
		it("stores created without ssrCookies share localStorage", () => {
			const store1 = createKheopskitStore();
			// store2 not used but demonstrates multiple stores can be created
			createKheopskitStore();

			store1.addEnabledWalletId("polkadot:talisman" as WalletId);

			// store2 won't see the update automatically (no cross-instance sync)
			// but localStorage is shared
			const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
			expect(stored.autoReconnect).toContain("polkadot:talisman");
		});
	});
});

describe("default store export", () => {
	it("exports a default store instance", () => {
		expect(store).toBeDefined();
		expect(store.observable).toBeDefined();
		expect(store.addEnabledWalletId).toBeDefined();
		expect(store.removeEnabledWalletId).toBeDefined();
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
			kstore.addEnabledWalletId(walletId);
		}

		const values: { autoReconnect?: WalletId[] }[] = [];
		const sub = kstore.observable.subscribe((v) => values.push(v));

		expect(values[0]?.autoReconnect).toHaveLength(validWalletIds.length);
		for (const walletId of validWalletIds) {
			expect(values[0]?.autoReconnect).toContain(walletId);
		}
		sub.unsubscribe();
	});

	it("handles adding and removing in sequence", () => {
		const kstore = createKheopskitStore();

		// Add all
		for (const walletId of validWalletIds) {
			kstore.addEnabledWalletId(walletId);
		}

		// Remove half
		const [first, second] = validWalletIds;
		if (first) kstore.removeEnabledWalletId(first);
		if (second) kstore.removeEnabledWalletId(second);
		const values: { autoReconnect?: WalletId[] }[] = [];
		const sub = kstore.observable.subscribe((v) => values.push(v));

		expect(values[0]?.autoReconnect).toHaveLength(2);
		expect(values[0]?.autoReconnect).not.toContain(validWalletIds[0]);
		expect(values[0]?.autoReconnect).not.toContain(validWalletIds[1]);
		expect(values[0]?.autoReconnect).toContain(validWalletIds[2]);
		expect(values[0]?.autoReconnect).toContain(validWalletIds[3]);
		sub.unsubscribe();
	});
});
