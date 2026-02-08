import { describe, expect, it } from "vitest";
import {
	getWalletAccountId,
	parseWalletAccountId,
	type WalletAccountId,
} from "./WalletAccountId";

// Valid SS58 address for testing
const VALID_SS58 = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const VALID_ETH = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

describe("getWalletAccountId", () => {
	it("creates valid account ID with SS58 address", () => {
		const result = getWalletAccountId("polkadot:talisman", VALID_SS58);
		expect(result).toBe(`polkadot:talisman::${VALID_SS58}`);
	});

	it("creates valid account ID with Ethereum address", () => {
		const result = getWalletAccountId("ethereum:metamask", VALID_ETH);
		expect(result).toBe(`ethereum:metamask::${VALID_ETH}`);
	});

	it("throws for missing walletId", () => {
		expect(() => getWalletAccountId("", VALID_SS58)).toThrow(
			"Missing walletId",
		);
	});

	it("throws for invalid address", () => {
		expect(() => getWalletAccountId("polkadot:talisman", "invalid")).toThrow(
			"Invalid address",
		);
	});

	it("throws for empty address", () => {
		expect(() => getWalletAccountId("polkadot:talisman", "")).toThrow(
			"Invalid address",
		);
	});
});

describe("parseWalletAccountId", () => {
	it("parses valid SS58 account ID", () => {
		const accountId = `polkadot:talisman::${VALID_SS58}`;
		const result = parseWalletAccountId(accountId);
		expect(result).toEqual({
			walletId: "polkadot:talisman",
			address: VALID_SS58,
		});
	});

	it("parses valid Ethereum account ID", () => {
		const accountId = `ethereum:metamask::${VALID_ETH}`;
		const result = parseWalletAccountId(accountId);
		expect(result).toEqual({
			walletId: "ethereum:metamask",
			address: VALID_ETH,
		});
	});

	it("throws for empty accountId", () => {
		expect(() => parseWalletAccountId("")).toThrow("Invalid walletAccountId");
	});

	it("throws for accountId without separator", () => {
		// Without :: separator, the split returns ["polkadot:talisman"] and address is undefined
		expect(() => parseWalletAccountId("polkadot:talisman")).toThrow(
			"Invalid address",
		);
	});

	it("throws for accountId with missing address", () => {
		expect(() => parseWalletAccountId("polkadot:talisman::")).toThrow(
			"Invalid address",
		);
	});

	it("throws for accountId with invalid address", () => {
		expect(() =>
			parseWalletAccountId("polkadot:talisman::invalid-address"),
		).toThrow("Invalid address");
	});
});

describe("WalletAccountId roundtrip", () => {
	it("parseWalletAccountId reverses getWalletAccountId (SS58)", () => {
		const walletId = "polkadot:subwallet-js";
		const accountId = getWalletAccountId(walletId, VALID_SS58);
		const parsed = parseWalletAccountId(accountId);

		expect(parsed.walletId).toBe(walletId);
		expect(parsed.address).toBe(VALID_SS58);
	});

	it("parseWalletAccountId reverses getWalletAccountId (Ethereum)", () => {
		const walletId = "ethereum:rainbow";
		const accountId = getWalletAccountId(walletId, VALID_ETH);
		const parsed = parseWalletAccountId(accountId);

		expect(parsed.walletId).toBe(walletId);
		expect(parsed.address).toBe(VALID_ETH);
	});
});

describe("WalletAccountId type", () => {
	it("WalletAccountId is a string type", () => {
		const accountId: WalletAccountId = `polkadot:test::${VALID_SS58}`;
		expect(typeof accountId).toBe("string");
	});
});
