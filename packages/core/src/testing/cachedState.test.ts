import { describe, expect, it } from "vitest";
import { createKheopskitStore } from "../api/store";
import { getWalletAccountId } from "../utils/WalletAccountId";
import { cachedAccountOf, cachedWalletOf } from "./cachedState";
import { createMemoryStorage } from "./memoryStorage";

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

describe("cachedWalletOf and cachedAccountOf", () => {
	it("build entries the store keeps", () => {
		const store = createKheopskitStore({ storage: createMemoryStorage() });
		const talisman = cachedWalletOf("polkadot:talisman", "Talisman");
		const alice = cachedAccountOf(talisman, ALICE, "Alice");

		store.setCachedState([talisman], [alice]);

		expect(store.getCachedState()).toEqual({
			wallets: [
				{
					id: "polkadot:talisman",
					platform: "polkadot",
					type: "injected",
					name: "Talisman",
					isConnected: true,
				},
			],
			accounts: [
				{
					id: getWalletAccountId("polkadot:talisman", ALICE),
					platform: "polkadot",
					address: ALICE,
					name: "Alice",
					walletId: "polkadot:talisman",
					walletName: "Talisman",
				},
			],
		});
	});

	it("leave the account name out when none is given", () => {
		const metamask = cachedWalletOf("ethereum:io.metamask", "MetaMask");

		expect(
			cachedAccountOf(metamask, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"),
		).not.toHaveProperty("name");
	});
});
