import { announceProvider, type EIP6963ProviderDetail } from "mipd";
import { firstValueFrom, of } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedAccountOf, cachedWalletOf } from "../testing/cachedState";
import { setCachedIcons } from "../utils/iconCache";
import { WALLET_CONNECT_WALLET_ID, type WalletId } from "../utils/WalletId";
import { ethereum } from "./ethereum/plugin";
import { getHydratedSnapshot } from "./hydration";
import { kheopskitRun$ } from "./kheopskit";
import { polkadot } from "./polkadot/plugin";
import { createKheopskitStore } from "./store";
import type {
	CachedAccount,
	CachedWallet,
	KheopskitConfig,
	KheopskitState,
	WalletConnectPlugin,
} from "./types";

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

const walletConnectPlugin: WalletConnectPlugin = {
	type: "walletconnect",
	metadata: { name: "Test Dapp", description: "", url: "", icons: [] },
	getWallet$: () => of(null),
};

const makeStore = (wallets = cachedWallets) => {
	localStorage.clear();
	const store = createKheopskitStore();
	store.setCachedState(wallets, cachedAccounts);
	return store;
};

const config = (
	autoReconnect: KheopskitConfig["autoReconnect"] = true,
	platforms = [polkadot(), ethereum()],
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
		const { wallets } = getHydratedSnapshot(store, {
			...config(false),
			walletConnect: walletConnectPlugin,
		});

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

describe("cached state of platforms the config does not enable", () => {
	const talisman = cachedWalletOf("polkadot:talisman", "Talisman");
	const metamask = cachedWalletOf("ethereum:io.metamask", "MetaMask");
	const phantom = cachedWalletOf("solana:Phantom", "Phantom");
	const walletConnectRow: CachedWallet = {
		id: WALLET_CONNECT_WALLET_ID,
		type: "walletconnect",
		name: "WalletConnect",
		isConnected: true,
	};
	const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
	const BOB = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
	const ETH_ADDRESS = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
	const SOL_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

	const talismanAlice = cachedAccountOf(talisman, ALICE);
	const walletConnectBob: CachedAccount = {
		id: `${WALLET_CONNECT_WALLET_ID}::${BOB}`,
		platform: "polkadot",
		address: BOB,
		walletId: WALLET_CONNECT_WALLET_ID,
		walletName: "WalletConnect",
	};
	const walletConnectEth: CachedAccount = {
		id: `${WALLET_CONNECT_WALLET_ID}::${ETH_ADDRESS}`,
		platform: "ethereum",
		address: ETH_ADDRESS,
		chainId: 1,
		walletId: WALLET_CONNECT_WALLET_ID,
		walletName: "WalletConnect",
	};

	const seedStore = () => {
		localStorage.clear();
		const store = createKheopskitStore();
		store.setCachedState(
			[metamask, talisman, phantom, walletConnectRow],
			[
				talismanAlice,
				cachedAccountOf(metamask, ETH_ADDRESS),
				cachedAccountOf(phantom, SOL_ADDRESS),
				walletConnectBob,
				walletConnectEth,
			],
		);
		return store;
	};

	it("hydrates only the Polkadot injected wallet and its accounts when WalletConnect is not configured", () => {
		const { wallets, accounts } = getHydratedSnapshot(seedStore(), {
			platforms: [polkadot()],
			autoReconnect: true,
		});

		expect(wallets.map((w) => w.id)).toEqual([talisman.id]);
		expect(accounts.map((a) => a.id)).toEqual([talismanAlice.id]);
	});

	it("keeps the WalletConnect row with only its Polkadot accounts when WalletConnect is configured", () => {
		const { wallets, accounts } = getHydratedSnapshot(seedStore(), {
			platforms: [polkadot()],
			autoReconnect: true,
			walletConnect: walletConnectPlugin,
		});

		expect(wallets.map((w) => w.id).sort()).toEqual(
			[talisman.id, WALLET_CONNECT_WALLET_ID].sort(),
		);
		expect(accounts.map((a) => a.id).sort()).toEqual(
			[talismanAlice.id, walletConnectBob.id].sort(),
		);
	});

	it("drops a cached WalletConnect account when no cached wallet row survives", () => {
		localStorage.clear();
		const store = createKheopskitStore();
		store.setCachedState([], [walletConnectBob]);

		const { accounts } = getHydratedSnapshot(store, {
			platforms: [polkadot()],
			autoReconnect: true,
		});

		expect(accounts).toEqual([]);
	});

	it("keeps the accounts of surviving wallets only", () => {
		localStorage.clear();
		const store = createKheopskitStore();
		const subwallet = cachedWalletOf("polkadot:subwallet-js", "SubWallet");
		store.setCachedState(
			[talisman],
			[talismanAlice, cachedAccountOf(subwallet, BOB), walletConnectBob],
		);

		const { accounts } = getHydratedSnapshot(store, {
			platforms: [polkadot()],
			autoReconnect: true,
			walletConnect: walletConnectPlugin,
		});

		expect(accounts.map((a) => a.id)).toEqual([talismanAlice.id]);
	});

	describe("through kheopskitRun$", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
			vi.restoreAllMocks();
		});

		it("never emits an Ethereum or Solana wallet or account, first frame or later", async () => {
			const emissions: KheopskitState[] = [];
			const sub = kheopskitRun$(
				{ platforms: [polkadot()], hydrationGracePeriod: 500 },
				{ store: seedStore() },
			).subscribe((state) => emissions.push(state));
			await vi.advanceTimersByTimeAsync(5000);
			sub.unsubscribe();

			expect(emissions[0]?.wallets.map((w) => w.id)).toEqual([talisman.id]);
			expect(emissions.at(-1)?.isHydrating).toBe(false);
			const platformsSeen = emissions.flatMap((state) => [
				...state.wallets.map((w) => w.id.split(":")[0]),
				...state.accounts.map((a) => a.platform),
			]);
			expect(platformsSeen.length).toBeGreaterThan(0);
			expect(
				platformsSeen.filter((p) => p === "ethereum" || p === "solana"),
			).toEqual([]);
		});

		it("makes no connect attempt for a remembered Ethereum wallet and keeps it remembered", async () => {
			const request = vi.fn(async () => [ETH_ADDRESS]);
			const unannounce = announceProvider({
				info: {
					uuid: "00000000-0000-4000-8000-000000000001",
					name: "MetaMask",
					icon: "data:image/svg+xml,",
					rdns: "io.metamask",
				},
				provider: {
					request,
					on: () => {},
					removeListener: () => {},
				} as unknown as EIP6963ProviderDetail["provider"],
			});
			const store = seedStore();
			store.rememberWallet(metamask.id);

			const sub = kheopskitRun$(
				{ platforms: [polkadot()], hydrationGracePeriod: 500 },
				{ store },
			).subscribe();
			await vi.advanceTimersByTimeAsync(5000);
			sub.unsubscribe();
			unannounce();

			expect(request).not.toHaveBeenCalled();
			expect((await firstValueFrom(store.observable)).remembered).toContain(
				metamask.id,
			);
		});
	});
});
