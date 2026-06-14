import { firstValueFrom, of, take, toArray } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { WALLET_CONNECT_WALLET_ID, type WalletId } from "../../utils/WalletId";
import type { PolkadotAccountType, WalletConnectWallet } from "../types";
import { getPolkadotAccounts$ } from "./accounts";
import type { PolkadotInjectedWallet } from "./types";

type ExtensionAccount = {
	address: string;
	name?: string;
	type: PolkadotAccountType;
	genesisHash: string | null;
	polkadotSigner: unknown;
};

const createMockExtension = (accounts: ExtensionAccount[]) => {
	const subscribe = vi.fn((cb: (value: ExtensionAccount[]) => void) => {
		cb(accounts);
		return () => {};
	});

	return {
		subscribe,
		getAccounts: vi.fn(() => accounts),
	} as unknown as PolkadotInjectedWallet["extension"];
};

const createMockInjectedWallet = (
	accounts: ExtensionAccount[],
	overrides: Partial<PolkadotInjectedWallet> = {},
): PolkadotInjectedWallet => ({
	id: "polkadot:test-wallet" as WalletId,
	platform: "polkadot",
	type: "injected",
	sourceId: "test-wallet",
	extension: createMockExtension(accounts),
	name: "Test Wallet",
	icon: "data:image/svg+xml,...",
	isConnected: true,
	connect: vi.fn(),
	disconnect: vi.fn(),
	...overrides,
});

describe("getPolkadotAccounts$", () => {
	it("keeps only configured account types", async () => {
		const wallet = createMockInjectedWallet([
			{
				address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
				name: "Alice",
				type: "sr25519",
				genesisHash: null,
				polkadotSigner: {} as never,
			},
			{
				address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
				name: "Eth Key",
				type: "ethereum",
				genesisHash: null,
				polkadotSigner: {} as never,
			},
		]);

		const accounts = await firstValueFrom(
			getPolkadotAccounts$(of([wallet]), ["sr25519", "ed25519", "ecdsa"]),
		);

		expect(accounts).toHaveLength(1);
		expect(accounts[0]?.type).toBe("sr25519");
		expect(accounts[0]?.walletId).toBe(wallet.id);
	});

	it("includes ethereum polkadot accounts when explicitly configured", async () => {
		const wallet = createMockInjectedWallet([
			{
				address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
				name: "Ethereum Key",
				type: "ethereum",
				genesisHash: null,
				polkadotSigner: {} as never,
			},
		]);

		const accounts = await firstValueFrom(
			getPolkadotAccounts$(of([wallet]), ["ethereum"]),
		);

		expect(accounts).toHaveLength(1);
		expect(accounts[0]?.type).toBe("ethereum");
	});

	it("returns no accounts and warns when allowlist is empty", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const wallet = createMockInjectedWallet([
			{
				address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
				name: "Alice",
				type: "sr25519",
				genesisHash: null,
				polkadotSigner: {} as never,
			},
		]);

		const accounts = await firstValueFrom(
			getPolkadotAccounts$(of([wallet]), []),
		);

		expect(accounts).toEqual([]);
		expect(warnSpy).toHaveBeenCalledWith(
			"[kheopskit] config.polkadotAccountTypes is empty; all Polkadot accounts will be filtered out.",
		);
		warnSpy.mockRestore();
	});

	describe("appKit (WalletConnect) wallets", () => {
		const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
		const BOB = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
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
	});
});
