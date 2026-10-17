import { BehaviorSubject, firstValueFrom, of, take } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWalletAccountId } from "../utils/WalletAccountId";
import type { WalletId } from "../utils/WalletId";
import { getAccounts$ } from "./accounts";
import { polkadot } from "./polkadot/plugin";
import type { PolkadotAccount, PolkadotWallet } from "./polkadot/types";
import { createKheopskitStore } from "./store";
import type { KheopskitConfig, KheopskitState } from "./types";
import { getWallets$ } from "./wallets";

vi.mock("./wallets", () => ({
	getWallets$: vi.fn(() => of([])),
}));

vi.mock("./accounts", () => ({
	getAccounts$: vi.fn(() => of([])),
}));

describe("getKheopskit$ cached account filtering", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("filters cached polkadot accounts that are not allowed by the plugin", async () => {
		const store = createKheopskitStore();
		const walletId = "polkadot:talisman" as WalletId;

		store.setCachedState(
			[
				{
					id: walletId,
					platform: "polkadot",
					type: "injected",
					name: "Talisman",
					isConnected: true,
				},
			],
			[
				{
					id: `${walletId}::5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY`,
					platform: "polkadot",
					address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
					walletId,
					walletName: "Talisman",
					polkadotAccountType: "ecdsa",
				},
			],
		);

		const { getKheopskit$ } = await import("./kheopskit");
		const state = await firstValueFrom(
			getKheopskit$(
				{
					platforms: [polkadot({ accountTypes: ["sr25519"] })],
					autoReconnect: true,
					debug: false,
					storageKey: "kheopskit",
					hydrationGracePeriod: 500,
				},
				{ store },
			).pipe(take(1)),
		);

		expect(state.accounts).toEqual([]);
	});

	it("keeps cached polkadot accounts when the key type is allowed", async () => {
		const store = createKheopskitStore();
		const walletId = "polkadot:talisman" as WalletId;

		store.setCachedState(
			[
				{
					id: walletId,
					platform: "polkadot",
					type: "injected",
					name: "Talisman",
					isConnected: true,
				},
			],
			[
				{
					id: `${walletId}::5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY`,
					platform: "polkadot",
					address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
					walletId,
					walletName: "Talisman",
					polkadotAccountType: "ed25519",
				},
			],
		);

		const { getKheopskit$ } = await import("./kheopskit");
		const state = await firstValueFrom(
			getKheopskit$(
				{
					platforms: [polkadot({ accountTypes: ["ed25519"] })],
					autoReconnect: true,
					debug: false,
					storageKey: "kheopskit",
					hydrationGracePeriod: 500,
				},
				{ store },
			).pipe(take(1)),
		);

		expect(state.accounts).toHaveLength(1);
		const account = state.accounts[0];
		expect(account?.platform).toBe("polkadot");
		expect(account?.address).toBe(
			"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
		);
	});
});

describe("getKheopskit$ account changes", () => {
	const walletId = "polkadot:talisman" as WalletId;
	const address = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
	const config: KheopskitConfig = {
		platforms: [polkadot({ accountTypes: ["sr25519"] })],
		autoReconnect: true,
		debug: false,
		storageKey: "kheopskit",
		hydrationGracePeriod: 500,
	};

	beforeEach(() => {
		localStorage.clear();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("re-emits and re-persists when an account is renamed", async () => {
		const wallet = {
			id: walletId,
			platform: "polkadot",
			type: "injected",
			name: "Talisman",
			icon: "",
			isConnected: true,
		} as PolkadotWallet;
		const account = {
			id: getWalletAccountId(walletId, address),
			platform: "polkadot",
			address,
			name: "Alice",
			type: "sr25519",
			walletId,
			walletName: "Talisman",
		} as PolkadotAccount;
		const accounts$ = new BehaviorSubject([account]);
		vi.mocked(getWallets$).mockReturnValueOnce(of([wallet]));
		vi.mocked(getAccounts$).mockReturnValueOnce(accounts$);

		const store = createKheopskitStore();
		const { getKheopskit$ } = await import("./kheopskit");
		const states: KheopskitState[] = [];
		const sub = getKheopskit$(config, { store }).subscribe((state) =>
			states.push(state),
		);
		await vi.advanceTimersByTimeAsync(2000);
		expect(store.getCachedState().accounts[0]?.name).toBe("Alice");
		const emissionsBeforeRename = states.length;

		accounts$.next([{ ...account, name: "Alice (renamed)" }]);
		await vi.advanceTimersByTimeAsync(100);

		expect(states).toHaveLength(emissionsBeforeRename + 1);
		expect(states.at(-1)?.accounts[0]?.name).toBe("Alice (renamed)");
		expect(store.getCachedState().accounts[0]?.name).toBe("Alice");

		await vi.advanceTimersByTimeAsync(1000);
		expect(store.getCachedState().accounts[0]?.name).toBe("Alice (renamed)");
		sub.unsubscribe();
	});
});
