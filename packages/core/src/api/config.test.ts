import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "./config";
import { polkadot } from "./polkadot/plugin";
import { solana } from "./solana/plugin";

describe("resolveConfig", () => {
	describe("default values", () => {
		it("returns defaults (and warns) when no config is provided", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

			const result = resolveConfig(undefined);

			expect(result).toEqual({
				autoReconnect: true,
				platforms: [],
				debug: false,
				storageKey: "kheopskit",
				hydrationGracePeriod: 500,
			});
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining("No platforms configured"),
			);

			warn.mockRestore();
		});

		it("does not warn when platforms are provided", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

			resolveConfig({ platforms: [polkadot()] });

			expect(warn).not.toHaveBeenCalled();
			warn.mockRestore();
		});
	});

	describe("overriding defaults", () => {
		it("keeps the provided platform plugins", () => {
			const plugin = polkadot();
			const result = resolveConfig({ platforms: [plugin] });

			expect(result.platforms).toEqual([plugin]);
			expect(result.autoReconnect).toBe(true);
			expect(result.debug).toBe(false);
		});

		it("overrides scalar fields", () => {
			const result = resolveConfig({
				platforms: [polkadot()],
				autoReconnect: false,
				debug: true,
				storageKey: "my-custom-key",
				hydrationGracePeriod: 0,
			});

			expect(result.autoReconnect).toBe(false);
			expect(result.debug).toBe(true);
			expect(result.storageKey).toBe("my-custom-key");
			expect(result.hydrationGracePeriod).toBe(0);
		});
	});

	describe("legacy platforms guard", () => {
		it("throws on v3-style string platform names", () => {
			expect(() =>
				resolveConfig({ platforms: ["polkadot", "ethereum"] as never }),
			).toThrow(/plugin instances/);
		});

		it("throws on plugin-like objects missing getWallets$", () => {
			expect(() =>
				resolveConfig({ platforms: [{ platform: "polkadot" } as never] }),
			).toThrow(/MIGRATING_TO_V4\.md/);
		});

		it("accepts valid plugin instances", () => {
			expect(() => resolveConfig({ platforms: [polkadot()] })).not.toThrow();
		});
	});

	describe("immutability", () => {
		it("does not mutate the input config", () => {
			const input = { platforms: [polkadot()], autoReconnect: false };
			const inputCopy = { ...input };

			resolveConfig(input);

			expect(input).toEqual(inputCopy);
		});

		it("returns a new object each time", () => {
			const result1 = resolveConfig({ platforms: [polkadot()] });
			const result2 = resolveConfig({ platforms: [polkadot()] });

			expect(result1).not.toBe(result2);
		});
	});
});

describe("plugin option validation", () => {
	it("warns about unknown polkadot accountTypes", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		polkadot({ accountTypes: ["sr25519", "typo" as never] });

		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("Unknown polkadot accountTypes"),
		);
		warn.mockRestore();
	});

	it("does not warn for valid polkadot accountTypes", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		polkadot({ accountTypes: ["sr25519", "ed25519", "ecdsa", "ethereum"] });

		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it("warns about an unknown solana chain", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		solana({ chain: "solana:nope" as never });

		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("Unknown solana chain"),
		);
		warn.mockRestore();
	});

	it("does not warn for a valid solana chain", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		solana({ chain: "solana:devnet" });

		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});
