import { describe, expect, it } from "vitest";
import type { Wallet } from "../api";
import { sortWallets } from "./sortWallets";

const createWallet = (
	name: string,
	platform: "polkadot" | "ethereum",
): Wallet =>
	({
		name,
		platform,
		id: `${platform}:${name.toLowerCase()}`,
	}) as Wallet;

describe("sortWallets", () => {
	describe("platform sorting", () => {
		it("puts polkadot wallets before ethereum wallets", () => {
			const polkadotWallet = createWallet("Subwallet", "polkadot");
			const ethereumWallet = createWallet("MetaMask", "ethereum");

			expect(sortWallets(polkadotWallet, ethereumWallet)).toBe(-1);
			expect(sortWallets(ethereumWallet, polkadotWallet)).toBe(1);
		});

		it("does not reorder wallets of the same platform based on platform alone", () => {
			const wallet1 = createWallet("Aardvark", "polkadot");
			const wallet2 = createWallet("Zebra", "polkadot");

			// Same platform, so it falls through to name sorting
			const result = sortWallets(wallet1, wallet2);
			expect(result).toBeLessThan(0); // A < Z alphabetically
		});
	});

	describe("name sorting within same platform", () => {
		it("prioritizes Talisman wallet (case insensitive)", () => {
			const talisman = createWallet("Talisman", "polkadot");
			const other = createWallet("SubWallet", "polkadot");

			expect(sortWallets(talisman, other)).toBe(-1);
			expect(sortWallets(other, talisman)).toBe(1);
		});

		it("handles talisman lowercase", () => {
			const talisman = createWallet("talisman", "polkadot");
			const other = createWallet("SubWallet", "polkadot");

			expect(sortWallets(talisman, other)).toBe(-1);
		});

		it("sorts alphabetically when neither is Talisman", () => {
			const alpha = createWallet("Alpha Wallet", "polkadot");
			const beta = createWallet("Beta Wallet", "polkadot");
			const zeta = createWallet("Zeta Wallet", "polkadot");

			expect(sortWallets(alpha, beta)).toBeLessThan(0);
			expect(sortWallets(beta, zeta)).toBeLessThan(0);
			expect(sortWallets(zeta, alpha)).toBeGreaterThan(0);
		});

		it("returns 0 for identical wallet names", () => {
			const wallet1 = createWallet("Same", "polkadot");
			const wallet2 = createWallet("Same", "polkadot");

			expect(sortWallets(wallet1, wallet2)).toBe(0);
		});
	});

	describe("sorting an array of wallets", () => {
		it("sorts wallets correctly with Array.sort", () => {
			const wallets = [
				createWallet("MetaMask", "ethereum"),
				createWallet("SubWallet", "polkadot"),
				createWallet("Talisman", "polkadot"),
				createWallet("Rainbow", "ethereum"),
				createWallet("Polkadot.js", "polkadot"),
			];

			const sorted = [...wallets].sort(sortWallets);

			// Polkadot wallets first, Talisman first among them
			expect(sorted[0].name).toBe("Talisman");
			expect(sorted[0].platform).toBe("polkadot");
			// Then other polkadot wallets alphabetically
			expect(sorted[1].name).toBe("Polkadot.js");
			expect(sorted[2].name).toBe("SubWallet");
			// Then ethereum wallets alphabetically
			expect(sorted[3].name).toBe("MetaMask");
			expect(sorted[4].name).toBe("Rainbow");
		});
	});
});
