import { describe, expect, it } from "vitest";
import { isWalletPlatform } from "./isWalletPlatform";

describe("isWalletPlatform", () => {
	describe("valid platforms", () => {
		it('returns true for "polkadot"', () => {
			expect(isWalletPlatform("polkadot")).toBe(true);
		});

		it('returns true for "ethereum"', () => {
			expect(isWalletPlatform("ethereum")).toBe(true);
		});
	});

	describe("invalid platforms", () => {
		it("returns false for unknown string", () => {
			expect(isWalletPlatform("bitcoin")).toBe(false);
			expect(isWalletPlatform("solana")).toBe(false);
			expect(isWalletPlatform("cosmos")).toBe(false);
		});

		it("returns false for empty string", () => {
			expect(isWalletPlatform("")).toBe(false);
		});

		it("returns false for null", () => {
			expect(isWalletPlatform(null)).toBe(false);
		});

		it("returns false for undefined", () => {
			expect(isWalletPlatform(undefined)).toBe(false);
		});

		it("returns false for number", () => {
			expect(isWalletPlatform(123)).toBe(false);
			expect(isWalletPlatform(0)).toBe(false);
		});

		it("returns false for boolean", () => {
			expect(isWalletPlatform(true)).toBe(false);
			expect(isWalletPlatform(false)).toBe(false);
		});

		it("returns false for object", () => {
			expect(isWalletPlatform({})).toBe(false);
			expect(isWalletPlatform({ platform: "polkadot" })).toBe(false);
		});

		it("returns false for array", () => {
			expect(isWalletPlatform([])).toBe(false);
			expect(isWalletPlatform(["polkadot"])).toBe(false);
		});

		it("returns false for similar but incorrect strings", () => {
			expect(isWalletPlatform("Polkadot")).toBe(false);
			expect(isWalletPlatform("POLKADOT")).toBe(false);
			expect(isWalletPlatform("Ethereum")).toBe(false);
			expect(isWalletPlatform("ETHEREUM")).toBe(false);
			expect(isWalletPlatform(" polkadot")).toBe(false);
			expect(isWalletPlatform("polkadot ")).toBe(false);
		});
	});

	describe("type guard behavior", () => {
		it("narrows type to WalletPlatform when true", () => {
			const platform: unknown = "polkadot";
			if (isWalletPlatform(platform)) {
				// TypeScript should now know platform is WalletPlatform
				const _p: "polkadot" | "ethereum" = platform;
				expect(_p).toBe("polkadot");
			}
		});
	});
});
