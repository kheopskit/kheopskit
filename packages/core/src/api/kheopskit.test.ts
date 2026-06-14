import { firstValueFrom, of, take } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletId } from "../utils/WalletId";
import { polkadot } from "./polkadot/plugin";
import { createKheopskitStore } from "./store";

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
				undefined,
				store,
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
				undefined,
				store,
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
