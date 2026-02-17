import { firstValueFrom, of, take, toArray } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import type { WalletId } from "../../utils/WalletId";
import type { EthereumAppKitWallet, EthereumInjectedWallet } from "../types";

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
	providerId: "mock-wallet",
	provider: provider as unknown as EthereumInjectedWallet["provider"],
	name: "Mock Wallet",
	icon: "data:image/svg+xml,...",
	isConnected: true,
	connect: vi.fn(),
	disconnect: vi.fn(),
	...overrides,
});

const createMockAppKitWallet = (
	provider: ReturnType<typeof createMockProvider>,
	overrides: Partial<EthereumAppKitWallet> = {},
): EthereumAppKitWallet => ({
	platform: "ethereum",
	type: "appKit",
	id: "ethereum:appkit" as WalletId,
	name: "AppKit",
	icon: "data:image/svg+xml,...",
	isConnected: true,
	connect: vi.fn(),
	disconnect: vi.fn(),
	appKit: {
		getAccount: vi.fn(() => ({
			allAccounts: [{ address: MOCK_ADDRESS }],
		})),
		getProvider: vi.fn(
			() =>
				provider as unknown as EthereumAppKitWallet["appKit"] extends infer T
					? T extends { getProvider: (...args: never[]) => infer P }
						? P
						: never
					: never,
		),
	} as unknown as EthereumAppKitWallet["appKit"],
	...overrides,
});

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
			(provider as unknown as { session: { topic: string } }).session = {
				topic: "test-topic",
			};
			(provider as unknown as { off: typeof provider.removeListener }).off =
				provider.removeListener;

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
	});
});
