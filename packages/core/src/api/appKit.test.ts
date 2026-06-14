import { firstValueFrom } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WALLET_CONNECT_WALLET_ID } from "../utils/WalletId";
import type { KheopskitConfig, WalletConnectWallet } from "./types";

const walletConnectConfig = {
	walletConnect: {
		projectId: "test",
		metadata: { name: "", description: "", url: "", icons: [] },
		networks: [{}],
	},
	debug: false,
} as unknown as KheopskitConfig;

describe("getWalletConnectWallet$ when @reown/appkit is unavailable", () => {
	afterEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
	});

	it("degrades to no connector and logs an error (optional peer dep missing)", async () => {
		vi.resetModules();
		// Simulate @reown/appkit not being installed: the dynamic import rejects.
		vi.doMock("@reown/appkit/core", () => {
			throw new Error("Cannot find module '@reown/appkit/core'");
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const { getWalletConnectWallet$, resetAppKitCache } = await import(
			"./appKit"
		);
		resetAppKitCache();

		const result = await firstValueFrom(
			getWalletConnectWallet$(walletConnectConfig),
		);

		expect(result).toBeNull();
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("@reown/appkit"),
			expect.anything(),
		);

		resetAppKitCache();
	});
});

describe("getWalletConnectWallet$ disconnect", () => {
	afterEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
	});

	it("awaits the underlying disconnect and drops cached accounts when the status flips to disconnected", async () => {
		vi.resetModules();
		const disconnect = vi.fn(() => Promise.resolve());
		// Capture the providers callback so the test can drive connect/disconnect
		// transitions, mirroring how AppKit reports them via subscribeProviders.
		let emitProviders: (p: Record<string, unknown>) => void = () => {};
		const fakeAppKit = {
			chainNamespaces: ["solana"],
			subscribeProviders: (cb: (p: Record<string, unknown>) => void) => {
				emitProviders = cb;
				cb({ solana: {} });
				return () => {};
			},
			getWalletInfo: () => ({ name: "WC", icon: "icon" }),
			open: vi.fn(() => Promise.resolve()),
			disconnect,
		};
		vi.doMock("@reown/appkit/core", () => ({
			createAppKit: () => fakeAppKit,
		}));

		const { getWalletConnectWallet$, resetAppKitCache } = await import(
			"./appKit"
		);
		const { getCachedObservable$, clearAllCachedObservables } = await import(
			"../utils/getCachedObservable"
		);
		resetAppKitCache();
		clearAllCachedObservables();

		const emissions: (WalletConnectWallet | null)[] = [];
		const sub = getWalletConnectWallet$(walletConnectConfig).subscribe((w) =>
			emissions.push(w),
		);
		// Keep the stream subscribed so the status pipeline (and its disconnect
		// cache-clearing) stays alive while we drive transitions.
		await vi.waitFor(() =>
			expect(emissions.at(-1)?.platforms).toContain("solana"),
		);

		const wallet = emissions.at(-1);
		expect(wallet?.isConnected).toBe(true);

		// Seed a cached account observable as the accounts layer would.
		const key = `accounts:${WALLET_CONNECT_WALLET_ID}:solana:solana:mainnet`;
		const original = { tag: "original" };
		expect(getCachedObservable$(key, () => original)).toBe(original);

		// disconnect() awaits the underlying AppKit disconnect.
		await wallet?.disconnect();
		expect(disconnect).toHaveBeenCalledTimes(1);
		// Cache is still present until the provider status actually flips.
		expect(getCachedObservable$(key, () => ({ tag: "stale" }))).toBe(original);

		// The provider going away flips the status to disconnected, which drops the
		// cached account observables — this also covers external disconnects, where
		// disconnect() is never called.
		emitProviders({});

		const fresh = { tag: "fresh" };
		expect(getCachedObservable$(key, () => fresh)).toBe(fresh);

		sub.unsubscribe();
		resetAppKitCache();
	});
});

describe("getWalletConnectWallet$ single-session connect model", () => {
	afterEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
	});

	// Fake AppKit whose connected namespaces the test drives via `emit`.
	const mockAppKit = (chainNamespaces: string[]) => {
		let emit: (p: Record<string, unknown>) => void = () => {};
		const fakeAppKit = {
			chainNamespaces,
			subscribeProviders: (cb: (p: Record<string, unknown>) => void) => {
				emit = cb;
				cb({}); // start fully disconnected
				return () => {};
			},
			getWalletInfo: () => undefined,
			open: vi.fn(() => Promise.resolve()),
			disconnect: vi.fn(() => Promise.resolve()),
		};
		vi.doMock("@reown/appkit/core", () => ({ createAppKit: () => fakeAppKit }));
		return { emit: (p: Record<string, unknown>) => emit(p) };
	};

	const subscribeConnector = async () => {
		const { getWalletConnectWallet$, resetAppKitCache } = await import(
			"./appKit"
		);
		resetAppKitCache();
		return { getWalletConnectWallet$, resetAppKitCache };
	};

	it("exposes a single disconnected connector (no platforms) while fully disconnected", async () => {
		vi.resetModules();
		mockAppKit(["polkadot", "eip155", "solana"]);
		const { getWalletConnectWallet$, resetAppKitCache } =
			await subscribeConnector();

		const emissions: (WalletConnectWallet | null)[] = [];
		const sub = getWalletConnectWallet$(walletConnectConfig).subscribe((w) =>
			emissions.push(w),
		);
		await vi.waitFor(() => expect(emissions.length).toBeGreaterThan(0));

		const wallet = emissions.at(-1);
		expect(wallet?.type).toBe("walletconnect");
		expect(wallet?.id).toBe(WALLET_CONNECT_WALLET_ID);
		expect(wallet?.isConnected).toBe(false);
		expect(wallet?.platforms).toEqual([]);

		sub.unsubscribe();
		resetAppKitCache();
	});

	it("reports only the namespaces the wallet approved (no dead per-platform entries)", async () => {
		vi.resetModules();
		const { emit } = mockAppKit(["polkadot", "eip155", "solana"]);
		const { getWalletConnectWallet$, resetAppKitCache } =
			await subscribeConnector();

		const emissions: (WalletConnectWallet | null)[] = [];
		const sub = getWalletConnectWallet$(walletConnectConfig).subscribe((w) =>
			emissions.push(w),
		);
		await vi.waitFor(() => expect(emissions.length).toBeGreaterThan(0));

		// Wallet approves only eip155 in the single pairing.
		emit({ eip155: {} });
		await vi.waitFor(() => expect(emissions.at(-1)?.isConnected).toBe(true));

		const wallet = emissions.at(-1);
		expect(wallet?.platforms).toEqual(["ethereum"]);

		sub.unsubscribe();
		resetAppKitCache();
	});

	it("reports every namespace when the wallet approves all of them", async () => {
		vi.resetModules();
		const { emit } = mockAppKit(["polkadot", "eip155", "solana"]);
		const { getWalletConnectWallet$, resetAppKitCache } =
			await subscribeConnector();

		const emissions: (WalletConnectWallet | null)[] = [];
		const sub = getWalletConnectWallet$(walletConnectConfig).subscribe((w) =>
			emissions.push(w),
		);
		await vi.waitFor(() => expect(emissions.length).toBeGreaterThan(0));

		emit({ polkadot: {}, eip155: {}, solana: {} });
		await vi.waitFor(() => expect(emissions.at(-1)?.platforms).toHaveLength(3));

		const wallet = emissions.at(-1);
		expect(wallet?.platforms).toEqual(["polkadot", "ethereum", "solana"]);
		expect(wallet?.isConnected).toBe(true);

		sub.unsubscribe();
		resetAppKitCache();
	});

	it("only reports namespaces AppKit was configured for", async () => {
		vi.resetModules();
		// Only eip155 enabled; even if a provider for another namespace appears,
		// it's not in the connector's platforms.
		const { emit } = mockAppKit(["eip155"]);
		const { getWalletConnectWallet$, resetAppKitCache } =
			await subscribeConnector();

		const emissions: (WalletConnectWallet | null)[] = [];
		const sub = getWalletConnectWallet$(walletConnectConfig).subscribe((w) =>
			emissions.push(w),
		);
		await vi.waitFor(() => expect(emissions.length).toBeGreaterThan(0));

		emit({ eip155: {}, polkadot: {} });
		await vi.waitFor(() => expect(emissions.at(-1)?.isConnected).toBe(true));

		const wallet = emissions.at(-1);
		expect(wallet?.platforms).toEqual(["ethereum"]);

		sub.unsubscribe();
		resetAppKitCache();
	});
});

describe("getWalletConnectWallet$ single AppKit instance", () => {
	afterEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
	});

	const makeCreateAppKit = () =>
		vi.fn(() => ({
			chainNamespaces: ["eip155"],
			subscribeProviders: (cb: (p: Record<string, unknown>) => void) => {
				cb({});
				return () => {};
			},
			getWalletInfo: () => undefined,
			open: vi.fn(() => Promise.resolve()),
			disconnect: vi.fn(() => Promise.resolve()),
		}));

	it("creates the AppKit instance at most once across teardown and re-subscribe", async () => {
		vi.resetModules();
		// createAppKit must run at most once per process — Reown AppKit cannot be
		// instantiated twice. The cached connector observable is multicast with
		// refCount:false so draining every subscriber and re-subscribing (React
		// unmount/remount, StrictMode) does NOT re-run the producer.
		const createAppKit = makeCreateAppKit();
		vi.doMock("@reown/appkit/core", () => ({ createAppKit }));

		const { getWalletConnectWallet$, resetAppKitCache } = await import(
			"./appKit"
		);
		resetAppKitCache();

		// First subscriber, then fully unsubscribe (drains refCount to 0).
		const sub1 = getWalletConnectWallet$(walletConnectConfig).subscribe();
		await vi.waitFor(() => expect(createAppKit).toHaveBeenCalledTimes(1));
		sub1.unsubscribe();

		// Re-subscribe after the previous subscriber drained — must reuse the
		// existing AppKit instance, not create a second one.
		const sub2 = getWalletConnectWallet$(walletConnectConfig).subscribe();
		await new Promise((r) => setTimeout(r, 10));
		expect(createAppKit).toHaveBeenCalledTimes(1);

		sub2.unsubscribe();
		resetAppKitCache();
	});

	it("warns when re-initialised with a different projectId", async () => {
		vi.resetModules();
		const createAppKit = makeCreateAppKit();
		vi.doMock("@reown/appkit/core", () => ({ createAppKit }));

		const { getWalletConnectWallet$, resetAppKitCache } = await import(
			"./appKit"
		);
		resetAppKitCache();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const cfgB = {
			...walletConnectConfig,
			walletConnect: {
				...walletConnectConfig.walletConnect,
				projectId: "different",
			},
		} as unknown as KheopskitConfig;

		const sub = getWalletConnectWallet$(walletConnectConfig).subscribe();
		getWalletConnectWallet$(cfgB); // different projectId → warns, reuses instance

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("already initialised with projectId"),
			expect.anything(),
			expect.anything(),
		);

		sub.unsubscribe();
		resetAppKitCache();
	});
});
