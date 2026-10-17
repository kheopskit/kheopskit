import { BehaviorSubject, firstValueFrom, of, take, toArray } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createFakePolkadotExtension,
	FAKE_SIGNATURE,
	type FakePolkadotAccount,
	type FakePolkadotExtension,
} from "../../testing/fakePolkadotExtension";
import { WALLET_CONNECT_WALLET_ID, type WalletId } from "../../utils/WalletId";
import type { WalletConnectWallet } from "../types";
import { getPolkadotAccounts$ } from "./accounts";
import type {
	PolkadotInjected,
	PolkadotInjectedAccount,
	PolkadotInjectedWallet,
} from "./types";
import { latestAccounts } from "./wallets";

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const BOB = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
const ETH = "0x8ba1f109551bd432803012645ac136ddd64dba72";

const alice: PolkadotInjectedAccount = {
	address: ALICE,
	name: "Alice",
	type: "sr25519",
	genesisHash: null,
};

const broken: PolkadotInjectedAccount = {
	address: "not-an-address",
	name: "Broken",
	type: "sr25519",
	genesisHash: null,
};

const createMockExtension = (
	accounts: PolkadotInjectedAccount[],
	overrides: Partial<PolkadotInjected["accounts"]> = {},
) => {
	const unsubscribe = vi.fn();
	const extension: PolkadotInjected = {
		accounts: {
			get: vi.fn(async () => accounts),
			subscribe: vi.fn((cb: (accounts: PolkadotInjectedAccount[]) => void) => {
				cb(accounts);
				return unsubscribe;
			}),
			...overrides,
		},
		signer: {
			signRaw: vi.fn(async () => ({ id: 1, signature: "0xabcd" as const })),
			signPayload: vi.fn(async () => ({ signature: "0x" })),
		},
	};
	latestAccounts.set(extension, accounts);
	return { extension, unsubscribe };
};

const injectedWalletWith = (
	extension: PolkadotInjected,
	overrides: Partial<PolkadotInjectedWallet> = {},
): PolkadotInjectedWallet => ({
	id: "polkadot:test-wallet" as WalletId,
	platform: "polkadot",
	type: "injected",
	sourceId: "test-wallet",
	extension,
	name: "Test Wallet",
	icon: "data:image/svg+xml,...",
	status: "connected",
	isConnected: true,
	connect: vi.fn(),
	disconnect: vi.fn(),
	...overrides,
});

const fakes: FakePolkadotExtension[] = [];

afterEach(() => {
	for (const fake of fakes.splice(0)) fake.uninstall();
});

const fakeInjectedWallet = async (accounts: FakePolkadotAccount[]) => {
	const fake = createFakePolkadotExtension({ name: "test-wallet", accounts });
	fakes.push(fake);
	const extension = (await window.injectedWeb3?.[fake.name]?.enable(
		"test",
	)) as unknown as PolkadotInjected;
	latestAccounts.set(extension, await extension.accounts.get());
	return { fake, wallet: injectedWalletWith(extension) };
};

const nextMacrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("getPolkadotAccounts$", () => {
	it("keeps only configured account types", async () => {
		const { wallet } = await fakeInjectedWallet([
			alice,
			{ address: ETH, name: "Eth Key", type: "ethereum", genesisHash: null },
		]);

		const accounts = await firstValueFrom(
			getPolkadotAccounts$(of([wallet]), ["sr25519", "ed25519", "ecdsa"]),
		);

		expect(accounts).toHaveLength(1);
		expect(accounts[0]?.type).toBe("sr25519");
		expect(accounts[0]?.walletId).toBe(wallet.id);
	});

	it("includes ethereum polkadot accounts when explicitly configured", async () => {
		const { wallet } = await fakeInjectedWallet([
			{
				address: ETH,
				name: "Ethereum Key",
				type: "ethereum",
				genesisHash: null,
			},
		]);

		const accounts = await firstValueFrom(
			getPolkadotAccounts$(of([wallet]), ["ethereum"]),
		);

		expect(accounts).toHaveLength(1);
		expect(accounts[0]?.type).toBe("ethereum");
	});

	it("re-emits when the extension renames an account", async () => {
		const { fake, wallet } = await fakeInjectedWallet([alice]);

		const names = firstValueFrom(
			getPolkadotAccounts$(of([wallet]), ["sr25519"]).pipe(take(2), toArray()),
		);
		fake.setAccounts([{ ...alice, name: "Alice (renamed)" }]);

		expect((await names).map((accounts) => accounts[0]?.name)).toEqual([
			"Alice",
			"Alice (renamed)",
		]);
	});

	it("returns no accounts and warns that polkadot({ accountTypes }) is empty", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { wallet } = await fakeInjectedWallet([alice]);

		const accounts = await firstValueFrom(
			getPolkadotAccounts$(of([wallet]), []),
		);

		expect(accounts).toEqual([]);
		expect(warnSpy).toHaveBeenCalledWith(
			"[kheopskit] polkadot({ accountTypes }) is empty; all Polkadot accounts will be filtered out.",
		);
		warnSpy.mockRestore();
	});

	it("passes readonly and partOfPortfolio through", async () => {
		const { wallet } = await fakeInjectedWallet([
			{ ...alice, readonly: true, partOfPortfolio: false },
		]);

		const [account] = await firstValueFrom(
			getPolkadotAccounts$(of([wallet]), ["sr25519"]),
		);

		expect(account?.readonly).toBe(true);
		expect(account?.partOfPortfolio).toBe(false);
	});

	it("unsubscribes the extension's account subscription on teardown and on disconnect", async () => {
		const tornDown = createMockExtension([alice]);
		const wallet = injectedWalletWith(tornDown.extension);
		const subscription = getPolkadotAccounts$(of([wallet]), [
			"sr25519",
		]).subscribe();
		expect(tornDown.unsubscribe).not.toHaveBeenCalled();
		subscription.unsubscribe();
		expect(tornDown.unsubscribe).toHaveBeenCalledTimes(1);

		const disconnected = createMockExtension([alice]);
		const wallets$ = new BehaviorSubject<PolkadotInjectedWallet[]>([]);
		const connected = injectedWalletWith(disconnected.extension, {
			disconnect: vi.fn(async () => {
				wallets$.next([
					{ ...connected, isConnected: false, extension: undefined },
				]);
			}),
		});
		wallets$.next([connected]);
		const held = getPolkadotAccounts$(wallets$, ["sr25519"]).subscribe();
		expect(disconnected.unsubscribe).not.toHaveBeenCalled();
		await connected.disconnect();
		expect(disconnected.unsubscribe).toHaveBeenCalledTimes(1);
		held.unsubscribe();
		expect(disconnected.unsubscribe).toHaveBeenCalledTimes(1);
	});

	it("emits the list read at connect before subscribe calls back", async () => {
		const { extension } = createMockExtension([alice], {
			subscribe: vi.fn(() => vi.fn()),
		});
		const wallet = injectedWalletWith(extension);
		const emissions: string[][] = [];

		const subscription = getPolkadotAccounts$(of([wallet]), [
			"sr25519",
		]).subscribe((accounts) =>
			emissions.push(accounts.map((account) => account.address)),
		);

		expect(emissions).toEqual([[ALICE]]);
		await nextMacrotask();
		expect(emissions).toEqual([[ALICE]]);
		expect(extension.accounts.get).not.toHaveBeenCalled();
		subscription.unsubscribe();
	});

	it("skips an account it cannot build and emits the rest from subscribe", async () => {
		const { wallet } = await fakeInjectedWallet([alice, broken]);
		const emissions: string[][] = [];

		const subscription = getPolkadotAccounts$(of([wallet]), [
			"sr25519",
		]).subscribe((accounts) =>
			emissions.push(accounts.map((account) => account.address)),
		);
		await nextMacrotask();

		expect(emissions).toEqual([[ALICE]]);
		subscription.unsubscribe();
	});

	it("skips an account it cannot build and emits the rest from the list read at connect", async () => {
		const { extension } = createMockExtension([alice, broken], {
			subscribe: vi.fn(() => vi.fn()),
		});
		const wallet = injectedWalletWith(extension);
		const emissions: string[][] = [];

		const subscription = getPolkadotAccounts$(of([wallet]), [
			"sr25519",
		]).subscribe((accounts) =>
			emissions.push(accounts.map((account) => account.address)),
		);
		await nextMacrotask();

		expect(emissions).toEqual([[ALICE]]);
		subscription.unsubscribe();
	});

	it("follows subscribe after the list read at connect", async () => {
		const { extension } = createMockExtension([alice], {
			subscribe: vi.fn((cb: (accounts: PolkadotInjectedAccount[]) => void) => {
				cb([{ ...alice, address: BOB }]);
				return vi.fn();
			}),
		});
		const wallet = injectedWalletWith(extension);
		const emissions: string[][] = [];

		const subscription = getPolkadotAccounts$(of([wallet]), [
			"sr25519",
		]).subscribe((accounts) =>
			emissions.push(accounts.map((account) => account.address)),
		);
		await nextMacrotask();

		expect(emissions).toEqual([[ALICE], [BOB]]);
		subscription.unsubscribe();
	});

	it.each([
		["a string", "hello", undefined, { data: "hello", type: "payload" }],
		["a string", "hello", { type: "bytes" }, { data: "hello", type: "bytes" }],
		[
			"a Uint8Array",
			new Uint8Array([1, 255]),
			undefined,
			{ data: "0x01ff", type: "bytes" },
		],
		[
			"a Uint8Array",
			new Uint8Array([1, 255]),
			{ type: "payload" },
			{ data: "0x01ff", type: "payload" },
		],
	] as const)(
		"signRaw sends %s %j with options %j as %j and returns the signature",
		async (_, data, options, sent) => {
			const { fake, wallet } = await fakeInjectedWallet([alice]);

			const [account] = await firstValueFrom(
				getPolkadotAccounts$(of([wallet]), ["sr25519"]),
			);
			if (!account) throw new Error("no account");

			await expect(account.signRaw(data, options)).resolves.toBe(
				FAKE_SIGNATURE,
			);
			expect(fake.signRawCalls()).toEqual([{ address: ALICE, ...sent }]);
		},
	);

	describe("appKit (WalletConnect) wallets", () => {
		const GENESIS = "91b171bb158e2d3848fa23a9f1c25182";

		const createMockAppKitWallet = (accounts: string[]) => {
			const listeners = new Map<string, Set<(props?: unknown) => void>>();
			const provider = {
				session: { topic: "t", namespaces: { polkadot: { accounts } } },
				client: { request: vi.fn() },
				on: vi.fn((event: string, cb: (props?: unknown) => void) => {
					let set = listeners.get(event);
					if (!set) {
						set = new Set();
						listeners.set(event, set);
					}
					set.add(cb);
				}),
				off: vi.fn((event: string, cb: (props?: unknown) => void) => {
					listeners.get(event)?.delete(cb);
				}),
				_emit: (event: string, props?: unknown) => {
					for (const cb of listeners.get(event) ?? []) cb(props);
				},
			};
			const wallet = {
				id: WALLET_CONNECT_WALLET_ID,
				type: "walletconnect",
				platforms: ["polkadot"],
				name: "WalletConnect",
				icon: "data:image/svg+xml;base64,AAAA",
				status: "connected",
				isConnected: true,
				connect: vi.fn(),
				disconnect: vi.fn(),
				appKit: {
					getProvider: vi.fn(() => provider),
					getCaipNetworks: vi.fn(() => [
						{ caipNetworkId: `polkadot:${GENESIS}` },
					]),
					// Empty on purpose: AppKit has no native polkadot adapter, so
					// getAccount("polkadot").allAccounts is always empty. Accounts must
					// come from session.namespaces (WalletConnect 0-accounts regression).
					getAccount: vi.fn(() => ({ allAccounts: [] })),
				} as unknown as WalletConnectWallet["appKit"],
			} as WalletConnectWallet;
			return { wallet, provider };
		};

		it("re-derives accounts when the WalletConnect session updates", async () => {
			const { clearAllCachedObservables } = await import(
				"../../utils/getCachedObservable"
			);
			clearAllCachedObservables();

			const { wallet, provider } = createMockAppKitWallet([
				`polkadot:${GENESIS}:${ALICE}`,
			]);

			const accounts$ = getPolkadotAccounts$(of([wallet]), ["sr25519"]);
			const resultsPromise = firstValueFrom(accounts$.pipe(take(2), toArray()));

			await new Promise((r) => setTimeout(r, 10));

			provider.session.namespaces.polkadot.accounts.push(
				`polkadot:${GENESIS}:${BOB}`,
			);
			provider._emit("session_update");

			const results = await resultsPromise;
			expect(results[0]).toHaveLength(1);
			expect(results[1]).toHaveLength(2);
		});

		// Regression: AppKit has no native polkadot adapter, so
		// getAccount("polkadot").allAccounts is always empty — accounts MUST be
		// derived from the WalletConnect session (the "0 accounts over
		// WalletConnect" bug). The mock keeps allAccounts empty to lock this in.
		it("lists accounts from session namespaces though allAccounts is empty", async () => {
			const { clearAllCachedObservables } = await import(
				"../../utils/getCachedObservable"
			);
			clearAllCachedObservables();

			const { wallet } = createMockAppKitWallet([
				`polkadot:${GENESIS}:${ALICE}`,
			]);
			expect(wallet.appKit.getAccount("polkadot")?.allAccounts).toHaveLength(0);

			const accounts = await firstValueFrom(
				getPolkadotAccounts$(of([wallet]), ["sr25519"]),
			);

			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.address).toBe(ALICE);
			expect(accounts[0]?.walletId).toBe(wallet.id);
		});

		it("dedupes one address advertised on multiple chains", async () => {
			const { clearAllCachedObservables } = await import(
				"../../utils/getCachedObservable"
			);
			clearAllCachedObservables();

			const OTHER_GENESIS = "b0a8d493285c2df73290dfb7e61f870f";
			const { wallet } = createMockAppKitWallet([
				`polkadot:${GENESIS}:${ALICE}`,
				`polkadot:${OTHER_GENESIS}:${ALICE}`,
			]);

			const accounts = await firstValueFrom(
				getPolkadotAccounts$(of([wallet]), ["sr25519"]),
			);

			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.address).toBe(ALICE);
		});

		it("returns no accounts when the provider has no session", async () => {
			const { clearAllCachedObservables } = await import(
				"../../utils/getCachedObservable"
			);
			clearAllCachedObservables();

			const { wallet } = createMockAppKitWallet([
				`polkadot:${GENESIS}:${ALICE}`,
			]);
			(
				wallet.appKit.getProvider as unknown as ReturnType<typeof vi.fn>
			).mockReturnValue({ session: undefined });

			const accounts = await firstValueFrom(
				getPolkadotAccounts$(of([wallet]), ["sr25519"]),
			);

			expect(accounts).toHaveLength(0);
		});

		it("exposes txCreator with polkadot-api v3", async () => {
			const { clearAllCachedObservables } = await import(
				"../../utils/getCachedObservable"
			);
			clearAllCachedObservables();

			const { wallet } = createMockAppKitWallet([
				`polkadot:${GENESIS}:${ALICE}`,
			]);

			const accounts = await firstValueFrom(
				getPolkadotAccounts$(of([wallet]), ["sr25519"]),
			);

			expect(accounts[0]).toHaveProperty("txCreator");
			expect(accounts[0]).not.toHaveProperty("polkadotSigner");
		});

		it("signRaw sends the text through polkadot_signMessage", async () => {
			const { clearAllCachedObservables } = await import(
				"../../utils/getCachedObservable"
			);
			clearAllCachedObservables();

			const { wallet, provider } = createMockAppKitWallet([
				`polkadot:${GENESIS}:${ALICE}`,
			]);
			provider.client.request.mockResolvedValue({ signature: "0xabcd" });

			const [account] = await firstValueFrom(
				getPolkadotAccounts$(of([wallet]), ["sr25519"]),
			);
			if (!account) throw new Error("no account");

			await expect(account.signRaw("hello")).resolves.toBe("0xabcd");
			expect(provider.client.request).toHaveBeenCalledWith({
				topic: "t",
				chainId: `polkadot:${GENESIS}`,
				request: {
					method: "polkadot_signMessage",
					params: { address: ALICE, message: "hello" },
				},
			});
		});
	});
});
