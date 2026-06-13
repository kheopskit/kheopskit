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

	it("clears cached account observables and awaits the underlying disconnect", async () => {
		vi.resetModules();
		const disconnect = vi.fn(() => Promise.resolve());
		const fakeAppKit = {
			chainNamespaces: ["solana"],
			subscribeProviders: (cb: (p: Record<string, unknown>) => void) => {
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

		const wallets = await firstValueFrom(
			getAppKitWallets$(walletConnectConfig),
		);
		const solana = wallets.solana;
		expect(solana?.isConnected).toBe(true);

		// Seed a cached account observable as the accounts layer would.
		const key = "accounts:solana:walletconnect:solana:mainnet";
		const original = { tag: "original" };
		expect(getCachedObservable$(key, () => original)).toBe(original);

		await solana?.disconnect();

		expect(disconnect).toHaveBeenCalledTimes(1);
		// Entry is gone, so the factory runs again and returns the fresh instance.
		const fresh = { tag: "fresh" };
		expect(getCachedObservable$(key, () => fresh)).toBe(fresh);

		resetAppKitCache();
	});
});
