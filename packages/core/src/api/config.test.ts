import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config";
import type { KheopskitConfig } from "./types";

describe("resolveConfig", () => {
	describe("default values", () => {
		it("returns default config when no config provided", () => {
			const result = resolveConfig(undefined);

			expect(result).toEqual({
				autoReconnect: true,
				platforms: ["polkadot"],
				debug: false,
			});
		});

		it("returns default config when empty object provided", () => {
			const result = resolveConfig({});

			expect(result.autoReconnect).toBe(true);
			expect(result.platforms).toEqual(["polkadot"]);
			expect(result.debug).toBe(false);
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
			expect(result.debug).toBe(false);
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
				debug: true,
			});

			expect(result).toEqual({
				autoReconnect: false,
				platforms: ["ethereum"],
				debug: true,
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
});
