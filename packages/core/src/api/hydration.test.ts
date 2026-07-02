import { describe, expect, it } from "vitest";
import { setCachedIcons } from "../utils/iconCache";
import type { WalletId } from "../utils/WalletId";
import { getHydratedSnapshot } from "./hydration";
import { polkadot } from "./polkadot/plugin";
import { createKheopskitStore } from "./store";
import type { CachedAccount, CachedWallet } from "./types";

const polkadotWalletId = "polkadot:talisman" as WalletId;
const ethereumWalletId = "ethereum:io.metamask" as WalletId;

const cachedWallets: CachedWallet[] = [
	{
		id: ethereumWalletId,
		platform: "ethereum",
		type: "injected",
		name: "MetaMask",
		isConnected: true,
	},
	{
		id: polkadotWalletId,
		platform: "polkadot",
		type: "injected",
		name: "Talisman",
		isConnected: true,
	},
];

const cachedAccounts: CachedAccount[] = [
	{
		id: `${polkadotWalletId}::5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY`,
		platform: "polkadot",
		address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
		walletId: polkadotWalletId,
		walletName: "Talisman",
		polkadotAccountType: "ecdsa",
	},
];

const makeStore = () => {
	localStorage.clear();
	const store = createKheopskitStore();
	store.setCachedState(cachedWallets, cachedAccounts);
	return store;
};

describe("getHydratedSnapshot", () => {
	it("hydrates and sorts wallets with the shared comparator (polkadot before ethereum)", () => {
		const store = makeStore();
		const { wallets } = getHydratedSnapshot(store, [polkadot()]);

		expect(wallets.map((w) => w.id)).toEqual([
			polkadotWalletId,
			ethereumWalletId,
		]);
		// Placeholders: connect/disconnect throw until the live wallet replaces them
		expect(() => wallets[0]?.connect()).toThrow(/still loading/);
	});

	it("filters cached accounts through the plugin's acceptsCachedAccount hook", () => {
		const store = makeStore();

		const rejected = getHydratedSnapshot(store, [
			polkadot({ accountTypes: ["sr25519"] }),
		]);
		expect(rejected.accounts).toEqual([]);

		const accepted = getHydratedSnapshot(store, [
			polkadot({ accountTypes: ["ecdsa"] }),
		]);
		expect(accepted.accounts).toHaveLength(1);
		expect(accepted.accounts[0]?.walletId).toBe(polkadotWalletId);
	});

	it("only enriches icons from the localStorage cache when icons: true", () => {
		const store = makeStore();
		setCachedIcons({ [ethereumWalletId]: "data:image/png;base64,abc" });

		const plain = getHydratedSnapshot(store, [polkadot()]);
		const ethPlain = plain.wallets.find((w) => w.id === ethereumWalletId);
		expect(ethPlain?.icon).toBe("");

		const enriched = getHydratedSnapshot(store, [polkadot()], { icons: true });
		const ethEnriched = enriched.wallets.find((w) => w.id === ethereumWalletId);
		expect(ethEnriched?.icon).toBe("data:image/png;base64,abc");
	});
});
