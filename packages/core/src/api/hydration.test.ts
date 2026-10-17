import { describe, expect, it } from "vitest";
import { setCachedIcons } from "../utils/iconCache";
import { WALLET_CONNECT_WALLET_ID, type WalletId } from "../utils/WalletId";
import { getHydratedSnapshot } from "./hydration";
import { polkadot } from "./polkadot/plugin";
import { createKheopskitStore } from "./store";
import type { CachedAccount, CachedWallet, KheopskitConfig } from "./types";

const polkadotWalletId = "polkadot:talisman" as WalletId;
const ethereumWalletId = "ethereum:io.metamask" as WalletId;

const cachedTalisman: CachedWallet = {
	id: polkadotWalletId,
	platform: "polkadot",
	type: "injected",
	name: "Talisman",
	isConnected: true,
};

const cachedWallets: CachedWallet[] = [
	{
		id: ethereumWalletId,
		platform: "ethereum",
		type: "injected",
		name: "MetaMask",
		isConnected: true,
	},
	cachedTalisman,
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

const makeStore = (wallets = cachedWallets) => {
	localStorage.clear();
	const store = createKheopskitStore();
	store.setCachedState(wallets, cachedAccounts);
	return store;
};

const config = (
	autoReconnect: KheopskitConfig["autoReconnect"] = true,
	platforms = [polkadot()],
) => ({ platforms, autoReconnect });

describe("getHydratedSnapshot", () => {
	it("hydrates and sorts wallets with the shared comparator (polkadot before ethereum)", () => {
		const store = makeStore();
		const { wallets } = getHydratedSnapshot(store, config());

		expect(wallets.map((w) => w.id)).toEqual([
			polkadotWalletId,
			ethereumWalletId,
		]);
		expect(wallets.map((w) => w.isPlaceholder)).toEqual([true, true]);
	});

	it("filters cached accounts through the plugin's acceptsCachedAccount hook", () => {
		const store = makeStore();

		const rejected = getHydratedSnapshot(
			store,
			config(true, [polkadot({ accountTypes: ["sr25519"] })]),
		);
		expect(rejected.accounts).toEqual([]);

		const accepted = getHydratedSnapshot(
			store,
			config(true, [polkadot({ accountTypes: ["ecdsa"] })]),
		);
		expect(accepted.accounts).toHaveLength(1);
		expect(accepted.accounts[0]?.walletId).toBe(polkadotWalletId);
		expect(accepted.accounts[0]?.isPlaceholder).toBe(true);
	});

	it("only enriches icons from the localStorage cache when icons: true", () => {
		const store = makeStore();
		setCachedIcons({ [ethereumWalletId]: "data:image/png;base64,abc" });

		const plain = getHydratedSnapshot(store, config());
		const ethPlain = plain.wallets.find((w) => w.id === ethereumWalletId);
		expect(ethPlain?.icon).toBe("");

		const enriched = getHydratedSnapshot(store, config(), { icons: true });
		const ethEnriched = enriched.wallets.find((w) => w.id === ethereumWalletId);
		expect(ethEnriched?.icon).toBe("data:image/png;base64,abc");
	});

	it("a cached connected wallet the predicate accepts hydrates as connecting, not connected, with its accounts as placeholders", () => {
		const store = makeStore();
		const { wallets, accounts } = getHydratedSnapshot(
			store,
			config((wallet) => wallet.id === polkadotWalletId),
		);

		const talisman = wallets.find((w) => w.id === polkadotWalletId);
		expect([talisman?.status, talisman?.isConnected]).toEqual([
			"connecting",
			false,
		]);
		expect(accounts.map((a) => a.walletId)).toEqual([polkadotWalletId]);
	});

	it("one the predicate rejects hydrates as disconnected without its accounts", () => {
		const store = makeStore();
		const { wallets, accounts } = getHydratedSnapshot(
			store,
			config((wallet) => wallet.id === ethereumWalletId),
		);

		expect(wallets.map((w) => [w.id, w.status, w.isConnected])).toEqual([
			[polkadotWalletId, "disconnected", false],
			[ethereumWalletId, "connecting", false],
		]);
		expect(accounts).toEqual([]);
	});

	it("with autoReconnect false every cached connected injected wallet hydrates as disconnected", () => {
		const store = makeStore();
		const { wallets, accounts } = getHydratedSnapshot(store, config(false));

		expect(wallets.map((w) => [w.id, w.status, w.isConnected])).toEqual([
			[polkadotWalletId, "disconnected", false],
			[ethereumWalletId, "disconnected", false],
		]);
		expect(accounts).toEqual([]);
	});

	it("a cached connected WalletConnect connector hydrates as connecting under autoReconnect false, since AppKit restores its own session", () => {
		const store = makeStore([
			cachedTalisman,
			{
				id: WALLET_CONNECT_WALLET_ID,
				type: "walletconnect",
				name: "WalletConnect",
				isConnected: true,
			},
		]);
		const { wallets } = getHydratedSnapshot(store, config(false));

		expect(wallets.map((w) => [w.id, w.status, w.isConnected])).toEqual([
			[polkadotWalletId, "disconnected", false],
			[WALLET_CONNECT_WALLET_ID, "connecting", false],
		]);
	});

	it("a cached disconnected wallet hydrates as disconnected whatever the predicate says", () => {
		const store = makeStore([{ ...cachedTalisman, isConnected: false }]);
		const { wallets, accounts } = getHydratedSnapshot(
			store,
			config(() => true),
		);

		expect(wallets.map((w) => w.status)).toEqual(["disconnected"]);
		expect(accounts).toEqual([]);
	});
});
