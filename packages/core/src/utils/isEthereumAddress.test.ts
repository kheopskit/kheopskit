import { describe, expect, it } from "vitest";
import { isEthereumAddress } from "./isEthereumAddress";

describe("isEthereumAddress", () => {
	describe("valid Ethereum addresses", () => {
		it("returns true for valid checksummed address", () => {
			expect(
				isEthereumAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"),
			).toBe(true);
		});

		it("returns true for lowercase address", () => {
			expect(
				isEthereumAddress("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"),
			).toBe(true);
		});

		it("returns false for uppercase address (after 0x)", () => {
			// viem's isAddress rejects all-uppercase addresses (not valid checksum)
			expect(
				isEthereumAddress("0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED"),
			).toBe(false);
		});

		it("returns true for zero address", () => {
			expect(
				isEthereumAddress("0x0000000000000000000000000000000000000000"),
			).toBe(true);
		});

		it("returns true for common test addresses", () => {
			expect(
				isEthereumAddress("0xdead000000000000000000000000000000000000"),
			).toBe(true);
			expect(
				isEthereumAddress("0x0000000000000000000000000000000000000001"),
			).toBe(true);
		});
	});

	describe("invalid Ethereum addresses", () => {
		it("returns false for address without 0x prefix", () => {
			expect(
				isEthereumAddress("5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"),
			).toBe(false);
		});

		it("returns false for too short address", () => {
			expect(isEthereumAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1Be")).toBe(
				false,
			);
		});

		it("returns false for too long address", () => {
			expect(
				isEthereumAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAedAA"),
			).toBe(false);
		});

		it("returns false for address with invalid characters", () => {
			expect(
				isEthereumAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeG"),
			).toBe(false);
		});

		it("returns false for empty string", () => {
			expect(isEthereumAddress("")).toBe(false);
		});

		it("returns false for just 0x", () => {
			expect(isEthereumAddress("0x")).toBe(false);
		});

		it("returns false for SS58 address", () => {
			expect(
				isEthereumAddress("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"),
			).toBe(false);
		});
	});
});
