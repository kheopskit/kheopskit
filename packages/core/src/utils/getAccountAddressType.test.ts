import { describe, expect, it } from "vitest";
import {
	type AccountAddressType,
	getAccountAddressType,
} from "./getAccountAddressType";

describe("getAccountAddressType", () => {
	describe("Ethereum addresses", () => {
		it('returns "ethereum" for valid Ethereum address', () => {
			expect(
				getAccountAddressType("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"),
			).toBe("ethereum");
		});

		it('returns "ethereum" for lowercase Ethereum address', () => {
			expect(
				getAccountAddressType("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"),
			).toBe("ethereum");
		});

		it('returns "ethereum" for zero address', () => {
			expect(
				getAccountAddressType("0x0000000000000000000000000000000000000000"),
			).toBe("ethereum");
		});
	});

	describe("SS58 addresses", () => {
		it('returns "ss58" for valid Polkadot address', () => {
			expect(
				getAccountAddressType(
					"15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5",
				),
			).toBe("ss58");
		});

		it('returns "ss58" for valid Kusama address', () => {
			expect(
				getAccountAddressType(
					"HNZata7iMYWmk5RvZRTiAsSDhV8366zq2YGb3tLH5Upf74F",
				),
			).toBe("ss58");
		});

		it('returns "ss58" for valid generic substrate address', () => {
			expect(
				getAccountAddressType(
					"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
				),
			).toBe("ss58");
		});
	});

	describe("invalid addresses", () => {
		it("throws for invalid Ethereum address (0x prefix but wrong format)", () => {
			expect(() => getAccountAddressType("0x123")).toThrow("Invalid address");
			expect(() => getAccountAddressType("0x")).toThrow("Invalid address");
		});

		it("throws for invalid SS58 address", () => {
			expect(() => getAccountAddressType("not-an-address")).toThrow(
				"Invalid address",
			);
		});

		it("throws for empty string", () => {
			expect(() => getAccountAddressType("")).toThrow("Invalid address");
		});
	});

	describe("type safety", () => {
		it("returns AccountAddressType union", () => {
			const result: AccountAddressType = getAccountAddressType(
				"0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
			);
			expect(["ss58", "ethereum"]).toContain(result);
		});
	});
});
