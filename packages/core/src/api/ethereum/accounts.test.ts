import { firstValueFrom, of, take, toArray } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { WALLET_CONNECT_WALLET_ID, type WalletId } from "../../utils/WalletId";
import type { WalletConnectWallet } from "../types";
import type { EthereumInjectedWallet } from "./types";

// Valid Ethereum address for tests
const MOCK_ADDRESS = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

// We need to test getEthereumAccounts$ which is the public API.
// The internal getInjectedWalletAccounts$ is exercised through it.

/**
 * Creates a mock EIP-1193 provider with event emitter support.
 */
const createMockProvider = () => {
	const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

	const provider = {
		request: vi.fn(),
		on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			let eventListeners = listeners.get(event);
			if (!eventListeners) {
				eventListeners = new Set();
				listeners.set(event, eventListeners);
			}
			eventListeners.add(handler);
		}),
		removeListener: vi.fn(
			(event: string, handler: (...args: unknown[]) => void) => {
				listeners.get(event)?.delete(handler);
			},
		),
		// Test helper to emit events
		_emit: (event: string, ...args: unknown[]) => {
			for (const handler of listeners.get(event) ?? []) {
				handler(...args);
			}
		},
		_listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
	};

	return provider;
};

const createMockInjectedWallet = (
	provider: ReturnType<typeof createMockProvider>,
	overrides: Partial<EthereumInjectedWallet> = {},
): EthereumInjectedWallet => ({
	platform: "ethereum",
	type: "injected",
	id: "ethereum:mock-wallet" as WalletId,
	sourceId: "mock-wallet",
	provider: provider as unknown as EthereumInjectedWallet["provider"],
	name: "Mock Wallet",
	icon: "data:image/svg+xml,...",
	isConnected: true,
	connect: vi.fn(),
	disconnect: vi.fn(),
	...overrides,
});

// The single platform-less WalletConnect connector, configured to carry the
// eip155 namespace.
const createMockAppKitWallet = (
	provider: ReturnType<typeof createMockProvider>,
	overrides: Partial<WalletConnectWallet> = {},
): WalletConnectWallet => ({
	type: "walletconnect",
	id: WALLET_CONNECT_WALLET_ID,
	platforms: ["ethereum"],
	name: "WalletConnect",
	icon: "data:image/svg+xml,...",
	isConnected: true,
	connect: vi.fn(),
	disconnect: vi.fn(),
	appKit: {
		// Empty on purpose: this AppKit instance is created with no native eip155
		// adapter, so eip155 runs through the WalletConnect UniversalProvider and
		// getAccount("eip155").allAccounts is ALWAYS empty. Accounts must come from
		// session.namespaces. Keeping this empty is the regression guard for the
		// WalletConnect 0-accounts bug — if the code starts reading allAccounts
		// again, every appKit test below loses its accounts.
		getAccount: vi.fn(() => ({ allAccounts: [] })),
		getProvider: vi.fn(() => provider),
	} as unknown as WalletConnectWallet["appKit"],
	...overrides,
});

/**
 * Attaches a WalletConnect session to a mock provider. The eip155 accounts are
 * derived from `session.namespaces` (CAIP-10 strings), mirroring how the AppKit
 * path reads them at runtime. Returns the session so tests can mutate
 * `namespaces` and re-emit `accountsChanged`.
 */
const setWalletConnectSession = (
	provider: ReturnType<typeof createMockProvider>,
	accounts: string[] = [`eip155:1:${MOCK_ADDRESS}`],
) => {
	const session = {
		topic: "test-topic",
		namespaces: { eip155: { accounts } },
	};
	(provider as unknown as { session: typeof session }).session = session;
	(provider as unknown as { off: typeof provider.removeListener }).off =
		provider.removeListener;
	return session;
};

describe("Ethereum chain ID tracking", () => {
	// Use dynamic import to avoid module-level caching issues
	const importAccounts = async () => {
		// Clear cached observables between tests
		const { clearAllCachedObservables } = await import(
			"../../utils/getCachedObservable"
		);
		clearAllCachedObservables();

		return import("./accounts");
	};

	describe("injected wallet chainId", () => {
		it("populates chainId from initial eth_chainId request", async () => {
			const provider = createMockProvider();
			provider.request.mockImplementation(async ({ method }) => {
				if (method === "eth_accounts") return [MOCK_ADDRESS];
				if (method === "eth_chainId") return "0x1"; // mainnet
				return null;
			});

			const wallet = createMockInjectedWallet(provider);
			const { getEthereumAccounts$ } = await importAccounts();

			const accounts = await firstValueFrom(getEthereumAccounts$(of([wallet])));

			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.chainId).toBe(1);
		});

		it("updates chainId on chainChanged event (hex string)", async () => {
			const provider = createMockProvider();
			provider.request.mockImplementation(async ({ method }) => {
				if (method === "eth_accounts") return [MOCK_ADDRESS];
				if (method === "eth_chainId") return "0x1";
				return null;
			});

			const wallet = createMockInjectedWallet(provider);
			const { getEthereumAccounts$ } = await importAccounts();

			const accounts$ = getEthereumAccounts$(of([wallet]));

			// Collect 2 emissions: initial + chain change
			const resultsPromise = firstValueFrom(accounts$.pipe(take(2), toArray()));

			// Wait a tick for initial values
			await new Promise((r) => setTimeout(r, 10));

			// Simulate chain switch to Polygon (0x89 = 137)
			provider._emit("chainChanged", "0x89");

			const results = await resultsPromise;
			expect(results).toHaveLength(2);
			expect(results[0]?.[0]?.chainId).toBe(1);
			expect(results[1]?.[0]?.chainId).toBe(137);
		});

		it("updates chainId on chainChanged event (numeric)", async () => {
			const provider = createMockProvider();
			provider.request.mockImplementation(async ({ method }) => {
				if (method === "eth_accounts") return [MOCK_ADDRESS];
				if (method === "eth_chainId") return "0x1";
				return null;
			});

			const wallet = createMockInjectedWallet(provider);
			const { getEthereumAccounts$ } = await importAccounts();

			const accounts$ = getEthereumAccounts$(of([wallet]));

			const resultsPromise = firstValueFrom(accounts$.pipe(take(2), toArray()));

			await new Promise((r) => setTimeout(r, 10));

			// Some wallets emit numeric chain ID
			provider._emit("chainChanged", 42161);

			const results = await resultsPromise;
			expect(results[1]?.[0]?.chainId).toBe(42161);
		});

		it("clears chainId on disconnect event", async () => {
			const provider = createMockProvider();
			provider.request.mockImplementation(async ({ method }) => {
				if (method === "eth_accounts") return [MOCK_ADDRESS];
				if (method === "eth_chainId") return "0x1";
				return null;
			});

			const wallet = createMockInjectedWallet(provider);
			const { getEthereumAccounts$ } = await importAccounts();

			const accounts$ = getEthereumAccounts$(of([wallet]));

			const resultsPromise = firstValueFrom(accounts$.pipe(take(2), toArray()));

			await new Promise((r) => setTimeout(r, 10));

			provider._emit("disconnect");

			const results = await resultsPromise;
			expect(results[0]?.[0]?.chainId).toBe(1);
			expect(results[1]?.[0]?.chainId).toBeUndefined();
		});

		it("removes all listeners on teardown", async () => {
			const provider = createMockProvider();
			provider.request.mockImplementation(async ({ method }) => {
				if (method === "eth_accounts") return [MOCK_ADDRESS];
				if (method === "eth_chainId") return "0x1";
				return null;
			});

			const wallet = createMockInjectedWallet(provider);
			const { getEthereumAccounts$ } = await importAccounts();

			const sub = getEthereumAccounts$(of([wallet])).subscribe();

			await new Promise((r) => setTimeout(r, 10));

			expect(provider._listenerCount("accountsChanged")).toBe(1);
			expect(provider._listenerCount("chainChanged")).toBe(1);
			expect(provider._listenerCount("disconnect")).toBe(1);

			sub.unsubscribe();

			expect(provider._listenerCount("accountsChanged")).toBe(0);
			expect(provider._listenerCount("chainChanged")).toBe(0);
			expect(provider._listenerCount("disconnect")).toBe(0);
		});

		it("disconnected wallet returns empty accounts with no listeners", async () => {
			const provider = createMockProvider();
			const wallet = createMockInjectedWallet(provider, {
				isConnected: false,
			});
			const { getEthereumAccounts$ } = await importAccounts();

			const accounts = await firstValueFrom(getEthereumAccounts$(of([wallet])));

			expect(accounts).toHaveLength(0);
			expect(provider.on).not.toHaveBeenCalled();
		});

		it("handles eth_chainId request failure gracefully", async () => {
			const provider = createMockProvider();
			provider.request.mockImplementation(async ({ method }) => {
				if (method === "eth_accounts") return [MOCK_ADDRESS];
				if (method === "eth_chainId") throw new Error("RPC error");
				return null;
			});

			const wallet = createMockInjectedWallet(provider);
			const { getEthereumAccounts$ } = await importAccounts();

			const accounts = await firstValueFrom(getEthereumAccounts$(of([wallet])));

			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.chainId).toBeUndefined();
		});
	});

	describe("isSameAccountsList change detection", () => {
		it("detects chainId changes even with same account IDs", async () => {
			const provider = createMockProvider();
			provider.request.mockImplementation(async ({ method }) => {
				if (method === "eth_accounts") return [MOCK_ADDRESS];
				if (method === "eth_chainId") return "0x1";
				return null;
			});

			const wallet = createMockInjectedWallet(provider);
			const { getEthereumAccounts$ } = await importAccounts();

			const accounts$ = getEthereumAccounts$(of([wallet]));

			const resultsPromise = firstValueFrom(accounts$.pipe(take(2), toArray()));

			await new Promise((r) => setTimeout(r, 10));

			// Chain switch — same account ID, different chainId
			provider._emit("chainChanged", "0xa");

			const results = await resultsPromise;
			// Both emissions should come through (not deduplicated)
			expect(results).toHaveLength(2);
			expect(results[0]?.[0]?.chainId).toBe(1);
			expect(results[1]?.[0]?.chainId).toBe(10);
		});
	});

	describe("appKit wallet chainId", () => {
		it("normalizes hex chainId from provider request", async () => {
			const provider = createMockProvider();
			setWalletConnectSession(provider);

			provider.request.mockImplementation(async ({ method }) => {
				if (method === "eth_chainId") return "0x89";
				return null;
			});

			const wallet = createMockAppKitWallet(provider);
			const { getEthereumAccounts$ } = await importAccounts();

			const accounts = await firstValueFrom(getEthereumAccounts$(of([wallet])));

			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.chainId).toBe(137);
		});

		it("updates chainId when appKit provider emits chainChanged", async () => {
			const provider = createMockProvider();
			setWalletConnectSession(provider);

			provider.request.mockImplementation(async ({ method }) => {
				if (method === "eth_chainId") return "0x1";
				return null;
			});

			const wallet = createMockAppKitWallet(provider);
			const { getEthereumAccounts$ } = await importAccounts();

			const accounts$ = getEthereumAccounts$(of([wallet]));
			const resultsPromise = firstValueFrom(accounts$.pipe(take(2), toArray()));

			await new Promise((r) => setTimeout(r, 10));
			provider._emit("chainChanged", "0x89");

			const results = await resultsPromise;
			expect(results).toHaveLength(2);
			expect(results[0]?.[0]?.chainId).toBe(1);
			expect(results[1]?.[0]?.chainId).toBe(137);
		});

		it("updates accounts when appKit provider emits accountsChanged", async () => {
			const provider = createMockProvider();
			// The session's eip155 namespace is read live on each change, so drive it
			// through a session whose accounts list we mutate by reference.
			const session = setWalletConnectSession(provider);

			provider.request.mockImplementation(async ({ method }) => {
				if (method === "eth_chainId") return "0x1";
				return null;
			});

			const SECOND_ADDRESS = "0x1111111111111111111111111111111111111111";
			const wallet = createMockAppKitWallet(provider);

			const { getEthereumAccounts$ } = await importAccounts();

			const accounts$ = getEthereumAccounts$(of([wallet]));
			const resultsPromise = firstValueFrom(accounts$.pipe(take(2), toArray()));

			await new Promise((r) => setTimeout(r, 10));

			// Wallet authorizes a second account, then notifies via accountsChanged.
			session.namespaces.eip155.accounts = [
				`eip155:1:${MOCK_ADDRESS}`,
				`eip155:1:${SECOND_ADDRESS}`,
			];
			provider._emit("accountsChanged", [MOCK_ADDRESS, SECOND_ADDRESS]);

			const results = await resultsPromise;
			expect(results).toHaveLength(2);
			expect(results[0]).toHaveLength(1);
			expect(results[1]).toHaveLength(2);
			expect(results[1]?.[1]?.address).toBe(SECOND_ADDRESS);
		});

		it("normalizes decimal chainId from provider request", async () => {
			const provider = createMockProvider();
			setWalletConnectSession(provider);

			provider.request.mockImplementation(async ({ method }) => {
				if (method === "eth_chainId") return "137";
				return null;
			});

			const wallet = createMockAppKitWallet(provider);
			const { getEthereumAccounts$ } = await importAccounts();

			const accounts = await firstValueFrom(getEthereumAccounts$(of([wallet])));

			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.chainId).toBe(137);
		});

		it("tears down appKit chain/account listeners on unsubscribe", async () => {
			const provider = createMockProvider();
			setWalletConnectSession(provider);

			provider.request.mockImplementation(async ({ method }) => {
				if (method === "eth_chainId") return "0x1";
				return null;
			});

			const wallet = createMockAppKitWallet(provider);
			const { getEthereumAccounts$ } = await importAccounts();

			const sub = getEthereumAccounts$(of([wallet])).subscribe();
			await new Promise((r) => setTimeout(r, 10));

			expect(provider._listenerCount("chainChanged")).toBe(1);
			expect(provider._listenerCount("accountsChanged")).toBe(1);
			expect(provider._listenerCount("session_update")).toBe(1);

			sub.unsubscribe();

			expect(provider._listenerCount("chainChanged")).toBe(0);
			expect(provider._listenerCount("accountsChanged")).toBe(0);
			expect(provider._listenerCount("session_update")).toBe(0);
		});
	});

	describe("appKit account derivation (WalletConnect 0-accounts regression)", () => {
		const importAccounts = async () => {
			const { clearAllCachedObservables } = await import(
				"../../utils/getCachedObservable"
			);
			clearAllCachedObservables();
			return import("./accounts");
		};

		// Regression: MetaMask mobile connected over WalletConnect showed
		// "Disconnect" but no account, because the code read
		// getAccount("eip155").allAccounts (always empty without a native eip155
		// adapter) instead of the WalletConnect session. allAccounts is empty in
		// every test here (see createMockAppKitWallet); accounts MUST come from
		// session.namespaces.
		it("lists the connected account from session namespaces", async () => {
			const provider = createMockProvider();
			setWalletConnectSession(provider);
			provider.request.mockImplementation(async () => "0x1");

			const wallet = createMockAppKitWallet(provider);
			// Prove the source of truth is the session, not allAccounts.
			expect(wallet.appKit.getAccount("eip155")?.allAccounts).toHaveLength(0);

			const { getEthereumAccounts$ } = await importAccounts();
			const accounts = await firstValueFrom(getEthereumAccounts$(of([wallet])));

			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.address).toBe(MOCK_ADDRESS);
		});

		it("dedupes one address advertised on multiple eip155 chains", async () => {
			const provider = createMockProvider();
			setWalletConnectSession(provider, [
				`eip155:1:${MOCK_ADDRESS}`,
				`eip155:137:${MOCK_ADDRESS}`,
			]);
			provider.request.mockImplementation(async () => "0x1");

			const wallet = createMockAppKitWallet(provider);
			const { getEthereumAccounts$ } = await importAccounts();
			const accounts = await firstValueFrom(getEthereumAccounts$(of([wallet])));

			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.address).toBe(MOCK_ADDRESS);
		});

		it("returns no accounts when the provider has no session", async () => {
			const provider = createMockProvider();
			// No setWalletConnectSession → provider.session is undefined.
			(provider as unknown as { off: typeof provider.removeListener }).off =
				provider.removeListener;

			const wallet = createMockAppKitWallet(provider);
			const { getEthereumAccounts$ } = await importAccounts();
			const accounts = await firstValueFrom(getEthereumAccounts$(of([wallet])));

			expect(accounts).toHaveLength(0);
		});
	});
});
