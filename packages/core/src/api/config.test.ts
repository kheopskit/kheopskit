import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "./config";
import type { KheopskitConfig } from "./types";

describe("resolveConfig", () => {
	describe("default values", () => {
		it("returns default config when no config provided", () => {
			const result = resolveConfig(undefined);

			expect(result).toEqual({
				autoReconnect: true,
				platforms: ["polkadot"],
				polkadotAccountTypes: ["sr25519", "ed25519", "ecdsa"],
				debug: false,
				storageKey: "kheopskit",
				hydrationGracePeriod: 500,
			});
		});

		it("returns default config when empty object provided", () => {
			const result = resolveConfig({});

			expect(result.autoReconnect).toBe(true);
			expect(result.platforms).toEqual(["polkadot"]);
			expect(result.polkadotAccountTypes).toEqual([
				"sr25519",
				"ed25519",
				"ecdsa",
			]);
			expect(result.debug).toBe(false);
			expect(result.storageKey).toBe("kheopskit");
		});
	});

	describe("overriding defaults", () => {
		it("overrides autoReconnect", () => {
			const result = resolveConfig({ autoReconnect: false });

			expect(result.autoReconnect).toBe(false);
			expect(result.platforms).toEqual(["polkadot"]);
			expect(result.debug).toBe(false);
		});

		it("overrides platforms", () => {
			const result = resolveConfig({ platforms: ["ethereum"] });

			expect(result.autoReconnect).toBe(true);
			expect(result.platforms).toEqual(["ethereum"]);
			expect(result.polkadotAccountTypes).toEqual([
				"sr25519",
				"ed25519",
				"ecdsa",
			]);
			expect(result.debug).toBe(false);
		});

		it("overrides polkadotAccountTypes", () => {
			const result = resolveConfig({
				polkadotAccountTypes: ["ethereum"],
			});

			expect(result.polkadotAccountTypes).toEqual(["ethereum"]);
		});

		it("overrides debug", () => {
			const result = resolveConfig({ debug: true });

			expect(result.autoReconnect).toBe(true);
			expect(result.debug).toBe(true);
		});

		it("supports multiple platforms", () => {
			const result = resolveConfig({
				platforms: ["polkadot", "ethereum"],
			});

			expect(result.platforms).toEqual(["polkadot", "ethereum"]);
		});

		it("overrides all values at once", () => {
			const result = resolveConfig({
				autoReconnect: false,
				platforms: ["ethereum"],
				polkadotAccountTypes: ["ecdsa"],
				debug: true,
				storageKey: "my-custom-key",
			});

			expect(result).toEqual({
				autoReconnect: false,
				platforms: ["ethereum"],
				polkadotAccountTypes: ["ecdsa"],
				debug: true,
				storageKey: "my-custom-key",
				hydrationGracePeriod: 500,
			});
		});
	});

	describe("immutability", () => {
		it("does not mutate the input config", () => {
			const input: Partial<KheopskitConfig> = { autoReconnect: false };
			const inputCopy = { ...input };

			resolveConfig(input);

			expect(input).toEqual(inputCopy);
		});

		it("returns a new object each time", () => {
			const result1 = resolveConfig({});
			const result2 = resolveConfig({});

			expect(result1).not.toBe(result2);
			expect(result1).toEqual(result2);
		});
	});

	describe("validation", () => {
		it("warns about unrecognized polkadotAccountTypes", () => {
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			resolveConfig({
				polkadotAccountTypes: ["sr25519", "typo" as never],
			});

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("Unknown polkadotAccountTypes"),
			);
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"typo"'));
			warnSpy.mockRestore();
		});

		it("does not warn for valid polkadotAccountTypes", () => {
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			resolveConfig({
				polkadotAccountTypes: ["sr25519", "ed25519", "ecdsa", "ethereum"],
			});

			expect(warnSpy).not.toHaveBeenCalled();
			warnSpy.mockRestore();
		});
	});
});
