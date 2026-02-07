import { describe, expect, it } from "vitest";
import { isValidAddress } from "./isValidAddress";

describe("isValidAddress", () => {
	describe("Ethereum addresses (0x prefix)", () => {
		it("returns true for valid Ethereum address", () => {
			expect(isValidAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(
				true,
			);
		});

		it("returns true for lowercase Ethereum address", () => {
			expect(isValidAddress("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed")).toBe(
				true,
			);
		});

		it("returns true for zero address", () => {
			expect(isValidAddress("0x0000000000000000000000000000000000000000")).toBe(
				true,
			);
		});

		it("returns false for invalid Ethereum address", () => {
			expect(isValidAddress("0x123")).toBe(false);
			expect(isValidAddress("0x")).toBe(false);
			expect(
				isValidAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeGG"),
			).toBe(false);
		});
	});

	describe("SS58 addresses (non-0x prefix)", () => {
		it("returns true for valid Polkadot address", () => {
			expect(
				isValidAddress("15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5"),
			).toBe(true);
		});

		it("returns true for valid Kusama address", () => {
			expect(
				isValidAddress("HNZata7iMYWmk5RvZRTiAsSDhV8366zq2YGb3tLH5Upf74F"),
			).toBe(true);
		});

		it("returns true for valid generic substrate address", () => {
			expect(
				isValidAddress("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"),
			).toBe(true);
		});

		it("returns false for invalid SS58 address", () => {
			expect(isValidAddress("not-an-address")).toBe(false);
			expect(isValidAddress("123456")).toBe(false);
		});
	});

	describe("edge cases", () => {
		it("returns false for empty string", () => {
			expect(isValidAddress("")).toBe(false);
		});

		it("handles addresses that look similar but are different types", () => {
			// Ethereum address is valid
			expect(isValidAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(
				true,
			);
			// Same hex without 0x would be treated as SS58 and fail
			expect(isValidAddress("5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(
				false,
			);
		});
	});
});
