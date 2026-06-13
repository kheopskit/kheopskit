import { describe, expect, it } from "vitest";
import { ethereum } from "./ethereum/plugin";
import { polkadot } from "./polkadot/plugin";
import { solana } from "./solana/plugin";
import type { KheopskitPlatform } from "./types";

describe("KheopskitPlatform variance", () => {
	it("assigns concrete platform plugins to the base KheopskitPlatform[]", () => {
		// Compile-time guard for the bivariant-method design in types.ts: each
		// concrete plugin (KheopskitPlatform<"polkadot", PolkadotWallet, …> etc.)
		// must stay assignable to the base KheopskitPlatform despite the
		// contravariant getWallets$/getAccounts$ parameters. If the variance trick
		// regresses (e.g. methods become arrow properties), this stops compiling.
		const platforms: readonly KheopskitPlatform[] = [
			polkadot(),
			ethereum(),
			solana(),
		];

		expect(platforms.map((p) => p.platform)).toEqual([
			"polkadot",
			"ethereum",
			"solana",
		]);
	});
});
