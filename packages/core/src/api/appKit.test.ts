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
