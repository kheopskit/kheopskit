import { describe, expect, it } from "vitest";
import { isSs58Address } from "./isSs58Address";

describe("isSs58Address", () => {
	describe("valid SS58 addresses", () => {
		it("returns true for valid Polkadot address (prefix 0)", () => {
			// Alice's address on Polkadot
			expect(
				isSs58Address("15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5"),
			).toBe(true);
		});

		it("returns true for valid Kusama address (prefix 2)", () => {
			expect(
				isSs58Address("HNZata7iMYWmk5RvZRTiAsSDhV8366zq2YGb3tLH5Upf74F"),
			).toBe(true);
		});

		it("returns true for valid generic substrate address (prefix 42)", () => {
			expect(
				isSs58Address("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"),
			).toBe(true);
		});
	});

	describe("invalid SS58 addresses", () => {
		it("returns false for empty string", () => {
			expect(isSs58Address("")).toBe(false);
		});

		it("returns false for Ethereum address", () => {
			expect(isSs58Address("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(
				false,
			);
		});

		it("returns false for random string", () => {
			expect(isSs58Address("not-an-address")).toBe(false);
		});

		it("returns false for address with invalid characters", () => {
			expect(
				isSs58Address("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQ0"),
			).toBe(false); // 0 is not in base58
		});

		it("returns false for address too short", () => {
			expect(isSs58Address("5GrwvaEF5zXb26Fz9rcQpDWS57Ct")).toBe(false);
		});

		it("returns false for address too long", () => {
			expect(
				isSs58Address(
					"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQYAAAAAAAA",
				),
			).toBe(false);
		});
	});

	describe("type guard behavior", () => {
		it("narrows type to SS58String when true", () => {
			const address: string =
				"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
			if (isSs58Address(address)) {
				// TypeScript should now know address is SS58String
				expect(address).toBe(
					"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
				);
			}
		});
	});
});
