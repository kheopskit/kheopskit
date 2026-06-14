import { describe, expect, it } from "vitest";
import {
	getSolanaCaip2,
	getSolanaChainIdFromCaip2,
	isSolanaChainId,
} from "./chains";

describe("solana chains CAIP-2 mapping", () => {
	it("round-trips current CAIP-2 ids back to their chain ids", () => {
		for (const chain of [
			"solana:mainnet",
			"solana:devnet",
			"solana:testnet",
		] as const) {
			expect(getSolanaChainIdFromCaip2(getSolanaCaip2(chain))).toBe(chain);
		}
	});

	it("maps AppKit's deprecated CAIP-2 ids back to their chain ids", () => {
		// Some wallets still place accounts in the WC session under AppKit's
		// deprecatedCaipNetworkId values — these must still be recognised.
		expect(
			getSolanaChainIdFromCaip2("solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ"),
		).toBe("solana:mainnet");
		expect(
			getSolanaChainIdFromCaip2("solana:8E9rvCKLFQia2Y35HXjjpWzj8weVo44K"),
		).toBe("solana:devnet");
	});

	it("returns undefined for unknown CAIP-2 ids", () => {
		expect(getSolanaChainIdFromCaip2("solana:does-not-exist")).toBeUndefined();
	});

	it("throws for a cluster with no CAIP-2 id (localnet)", () => {
		expect(isSolanaChainId("solana:localnet")).toBe(true);
		expect(() => getSolanaCaip2("solana:localnet")).toThrow();
	});
});
