import { describe, expect, it } from "vitest";
import { getWalletId, parseWalletId, type WalletId } from "./WalletId";

describe("getWalletId", () => {
	it("creates valid polkadot wallet ID", () => {
		expect(getWalletId("polkadot", "polkadot-js")).toBe("polkadot:polkadot-js");
	});

	it("creates valid ethereum wallet ID", () => {
		expect(getWalletId("ethereum", "metamask")).toBe("ethereum:metamask");
	});

	it("handles various identifier names", () => {
		expect(getWalletId("polkadot", "talisman")).toBe("polkadot:talisman");
		expect(getWalletId("polkadot", "subwallet-js")).toBe(
			"polkadot:subwallet-js",
		);
		expect(getWalletId("ethereum", "rainbow")).toBe("ethereum:rainbow");
	});

	it("throws for invalid platform", () => {
		// @ts-expect-error testing invalid input
		expect(() => getWalletId("invalid", "wallet")).toThrow("Invalid platform");
		// @ts-expect-error testing invalid input
		expect(() => getWalletId("", "wallet")).toThrow("Invalid platform");
		// @ts-expect-error testing invalid input
		expect(() => getWalletId(null, "wallet")).toThrow("Invalid platform");
	});

	it("throws for empty identifier", () => {
		expect(() => getWalletId("polkadot", "")).toThrow("Invalid name");
	});
});

describe("parseWalletId", () => {
	it("parses polkadot wallet ID", () => {
		const result = parseWalletId("polkadot:polkadot-js");
		expect(result).toEqual({
			platform: "polkadot",
			identifier: "polkadot-js",
		});
	});

	it("parses ethereum wallet ID", () => {
		const result = parseWalletId("ethereum:metamask");
		expect(result).toEqual({
			platform: "ethereum",
			identifier: "metamask",
		});
	});

	it("handles identifiers with special characters", () => {
		const result = parseWalletId("polkadot:sub-wallet-js");
		expect(result).toEqual({
			platform: "polkadot",
			identifier: "sub-wallet-js",
		});
	});

	it("throws for empty walletId", () => {
		expect(() => parseWalletId("")).toThrow("Invalid walletId");
	});

	it("throws for invalid platform in walletId", () => {
		expect(() => parseWalletId("invalid:wallet")).toThrow("Invalid platform");
		expect(() => parseWalletId(":wallet")).toThrow("Invalid platform");
	});

	it("throws for missing identifier", () => {
		expect(() => parseWalletId("polkadot:")).toThrow("Invalid address");
		expect(() => parseWalletId("polkadot")).toThrow("Invalid address");
	});
});

describe("WalletId roundtrip", () => {
	it("parseWalletId reverses getWalletId", () => {
		const walletId = getWalletId("polkadot", "talisman");
		const parsed = parseWalletId(walletId);
		expect(parsed.platform).toBe("polkadot");
		expect(parsed.identifier).toBe("talisman");
	});

	it("handles all valid platform/identifier combinations", () => {
		const testCases: Array<{ platform: "polkadot" | "ethereum"; id: string }> =
			[
				{ platform: "polkadot", id: "polkadot-js" },
				{ platform: "polkadot", id: "talisman" },
				{ platform: "polkadot", id: "subwallet-js" },
				{ platform: "ethereum", id: "metamask" },
				{ platform: "ethereum", id: "rainbow" },
				{ platform: "ethereum", id: "coinbase-wallet" },
			];

		for (const { platform, id } of testCases) {
			const walletId = getWalletId(platform, id);
			const parsed = parseWalletId(walletId);
			expect(parsed.platform).toBe(platform);
			expect(parsed.identifier).toBe(id);
		}
	});
});

describe("WalletId type", () => {
	it("WalletId is a string type", () => {
		const walletId: WalletId = "polkadot:test";
		expect(typeof walletId).toBe("string");
	});
});
