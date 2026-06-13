import { describe, expect, it } from "vitest";
import { isSolanaAddress } from "./isSolanaAddress";

describe("isSolanaAddress", () => {
	describe("valid Solana addresses", () => {
		it("returns true for a base58 32-byte public key", () => {
			expect(
				isSolanaAddress("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"),
			).toBe(true);
		});

		it("returns true for well-known program ids", () => {
			expect(isSolanaAddress("11111111111111111111111111111111")).toBe(true);
			expect(
				isSolanaAddress("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
			).toBe(true);
			expect(
				isSolanaAddress("So11111111111111111111111111111111111111112"),
			).toBe(true);
		});
	});

	describe("invalid Solana addresses", () => {
		it("returns false for SS58 (substrate) addresses", () => {
			expect(
				isSolanaAddress("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"),
			).toBe(false);
			expect(
				isSolanaAddress("15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5"),
			).toBe(false);
		});

		it("returns false for Ethereum addresses", () => {
			expect(
				isSolanaAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"),
			).toBe(false);
		});

		it("returns false for non-base58 / wrong-length strings", () => {
			expect(isSolanaAddress("not-an-address")).toBe(false);
			expect(isSolanaAddress("123456")).toBe(false);
			expect(isSolanaAddress("")).toBe(false);
		});
	});
});
