import { describe, expect, it } from "vitest";
import type { BaseWalletAccount } from "../api/types";
import { sortAccounts } from "./sortAccounts";
import { getWalletId } from "./WalletId";

const createAccount = (
	platform: "polkadot" | "ethereum" | "solana",
	walletName: string,
	name: string | undefined,
	address: string,
): BaseWalletAccount =>
	((walletId) =>
		({
			id: `${walletId}::${address}`,
			platform,
			walletId,
			walletName,
			name,
			address,
		}) as BaseWalletAccount)(
		getWalletId(platform, walletName.toLowerCase().replace(/\s+/g, "-")),
	);

describe("sortAccounts", () => {
	describe("platform sorting", () => {
		it("puts polkadot accounts before ethereum accounts", () => {
			const polkadotAccount = createAccount(
				"polkadot",
				"SubWallet",
				"Account 1",
				"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
			);
			const ethereumAccount = createAccount(
				"ethereum",
				"MetaMask",
				"Account 1",
				"0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
			);

			expect(sortAccounts(polkadotAccount, ethereumAccount)).toBe(-1);
		});

		it("ethereum accounts come after polkadot accounts", () => {
			const polkadotAccount = createAccount(
				"polkadot",
				"SubWallet",
				"Account 1",
				"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
			);
			const ethereumAccount = createAccount(
				"ethereum",
				"MetaMask",
				"Account 1",
				"0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
			);

			// When first is polkadot, second is ethereum -> -1
			expect(sortAccounts(polkadotAccount, ethereumAccount)).toBe(-1);
		});
	});

	describe("polkadot account sorting", () => {
		it("prioritizes talisman wallet (lowercase)", () => {
			const talismanAccount = createAccount(
				"polkadot",
				"talisman",
				"Account 1",
				"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
			);
			const otherAccount = createAccount(
				"polkadot",
				"subwallet",
				"Account 1",
				"5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty",
			);

			expect(sortAccounts(talismanAccount, otherAccount)).toBe(-1);
			expect(sortAccounts(otherAccount, talismanAccount)).toBe(1);
		});

		it("sorts by wallet name when neither is talisman", () => {
			const alphaWallet = createAccount(
				"polkadot",
				"alpha",
				"Account 1",
				"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
			);
			const betaWallet = createAccount(
				"polkadot",
				"beta",
				"Account 1",
				"5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty",
			);

			expect(sortAccounts(alphaWallet, betaWallet)).toBeLessThan(0);
			expect(sortAccounts(betaWallet, alphaWallet)).toBeGreaterThan(0);
		});
	});

	describe("ethereum account sorting", () => {
		it("prioritizes Talisman wallet (capitalized)", () => {
			const talismanAccount = createAccount(
				"ethereum",
				"Talisman",
				"Account 1",
				"0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
			);
			const otherAccount = createAccount(
				"ethereum",
				"MetaMask",
				"Account 1",
				"0x742d35Cc6634C0532925a3b844Bc9e7595f8fEb2",
			);

			expect(sortAccounts(talismanAccount, otherAccount)).toBe(-1);
			expect(sortAccounts(otherAccount, talismanAccount)).toBe(1);
		});

		it("sorts by wallet name when neither is Talisman", () => {
			const metamask = createAccount(
				"ethereum",
				"MetaMask",
				"Account 1",
				"0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
			);
			const rainbow = createAccount(
				"ethereum",
				"Rainbow",
				"Account 1",
				"0x742d35Cc6634C0532925a3b844Bc9e7595f8fEb2",
			);

			expect(sortAccounts(metamask, rainbow)).toBeLessThan(0);
		});
	});

	describe("sorting an array of accounts", () => {
		it("keeps a wallet's accounts in the order the extension reported", () => {
			const reported = [
				createAccount(
					"solana",
					"Phantom",
					"Sol",
					"So11111111111111111111111111111111111111112",
				),
				createAccount(
					"ethereum",
					"Talisman",
					"Eth",
					"0x742d35Cc6634C0532925a3b844Bc9e7595f8fEb2",
				),
				createAccount(
					"polkadot",
					"SubWallet",
					"Zed",
					"5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty",
				),
				createAccount(
					"polkadot",
					"SubWallet",
					"Amy",
					"5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy",
				),
				createAccount(
					"polkadot",
					"Talisman",
					"Zoe",
					"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
				),
				createAccount(
					"polkadot",
					"Talisman",
					"Ann",
					"5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw",
				),
			];

			const sorted = [...reported].sort(sortAccounts);

			expect(
				sorted.map((a) => `${a.platform}/${a.walletName}/${a.name}`),
			).toEqual([
				"polkadot/Talisman/Zoe",
				"polkadot/Talisman/Ann",
				"polkadot/SubWallet/Zed",
				"polkadot/SubWallet/Amy",
				"ethereum/Talisman/Eth",
				"solana/Phantom/Sol",
			]);
		});

		it("sorts accounts correctly with Array.sort", () => {
			const accounts = [
				createAccount(
					"ethereum",
					"MetaMask",
					"MetaMask 1",
					"0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
				),
				createAccount(
					"polkadot",
					"subwallet",
					"SubWallet 1",
					"5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty",
				),
				createAccount(
					"polkadot",
					"talisman",
					"Talisman 1",
					"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
				),
				createAccount(
					"ethereum",
					"Talisman",
					"Talisman ETH",
					"0x742d35Cc6634C0532925a3b844Bc9e7595f8fEb2",
				),
			];

			const sorted = [...accounts].sort(sortAccounts);

			// Polkadot accounts first, talisman wallet prioritized
			expect(sorted[0]?.platform).toBe("polkadot");
			expect(sorted[0]?.walletName).toBe("talisman");
			expect(sorted[1]?.platform).toBe("polkadot");
			expect(sorted[1]?.walletName).toBe("subwallet");
			// Ethereum accounts after, Talisman wallet prioritized
			expect(sorted[2]?.platform).toBe("ethereum");
			expect(sorted[2]?.walletName).toBe("Talisman");
			expect(sorted[3]?.platform).toBe("ethereum");
			expect(sorted[3]?.walletName).toBe("MetaMask");
		});
	});
});
