import { firstValueFrom } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KheopskitConfig } from "./types";

const walletConnectConfig = {
	walletConnect: {
		projectId: "test",
		metadata: { name: "", description: "", url: "", icons: [] },
		networks: [{}],
	},
	debug: false,
} as unknown as KheopskitConfig;

describe("getAppKitWallets$ when @reown/appkit is unavailable", () => {
	afterEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
		vi.unmock("@reown/appkit/core");
	});

	it("degrades to no AppKit wallets and logs an error (optional peer dep missing)", async () => {
		vi.resetModules();
		// Simulate @reown/appkit not being installed: the dynamic import rejects.
		vi.doMock("@reown/appkit/core", () => {
			throw new Error("Cannot find module '@reown/appkit/core'");
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const { getAppKitWallets$, resetAppKitCache } = await import("./appKit");
		resetAppKitCache();

		const result = await firstValueFrom(getAppKitWallets$(walletConnectConfig));

		expect(result).toEqual({});
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("@reown/appkit"),
			expect.anything(),
		);

		resetAppKitCache();
	});
});

describe("getAppKitWallets$ disconnect", () => {
	afterEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
		vi.unmock("@reown/appkit/core");
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

		const { getAppKitWallets$, resetAppKitCache } = await import("./appKit");
		const { getCachedObservable$, clearAllCachedObservables } = await import(
			"../utils/getCachedObservable"
		);
		resetAppKitCache();
		clearAllCachedObservables();

		const emissions: Array<{
			solana?: { isConnected: boolean; disconnect: () => Promise<void> };
		}> = [];
		const sub = getAppKitWallets$(walletConnectConfig).subscribe((w) =>
			emissions.push(w),
		);
		// Keep the stream subscribed so the status pipeline (and its disconnect
		// cache-clearing) stays alive while we drive transitions.
		await vi.waitFor(() =>
			expect(emissions.at(-1)?.solana?.isConnected).toBe(true),
		);

		const solana = emissions.at(-1)?.solana;

		// Seed a cached account observable as the accounts layer would.
		const key = "accounts:solana:walletconnect:solana:mainnet";
		const original = { tag: "original" };
		expect(getCachedObservable$(key, () => original)).toBe(original);

		// disconnect() awaits the underlying AppKit disconnect.
		await solana?.disconnect();
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
