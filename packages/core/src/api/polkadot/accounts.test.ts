import { firstValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import type { WalletId } from "../../utils/WalletId";
import type { PolkadotAccountType, PolkadotInjectedWallet } from "../types";
import { getPolkadotAccounts$ } from "./accounts";

type ExtensionAccount = {
	address: string;
	name?: string;
	type: PolkadotAccountType;
	genesisHash: string | null;
	polkadotSigner: unknown;
};

const createMockExtension = (accounts: ExtensionAccount[]) => {
	const subscribe = vi.fn((cb: (value: ExtensionAccount[]) => void) => {
		cb(accounts);
		return () => {};
	});

	return {
		subscribe,
		getAccounts: vi.fn(() => accounts),
	} as unknown as PolkadotInjectedWallet["extension"];
};

const createMockInjectedWallet = (
	accounts: ExtensionAccount[],
	overrides: Partial<PolkadotInjectedWallet> = {},
): PolkadotInjectedWallet => ({
	id: "polkadot:test-wallet" as WalletId,
	platform: "polkadot",
	type: "injected",
	extensionId: "test-wallet",
	extension: createMockExtension(accounts),
	name: "Test Wallet",
	icon: "data:image/svg+xml,...",
	isConnected: true,
	connect: vi.fn(),
	disconnect: vi.fn(),
	...overrides,
});

describe("getPolkadotAccounts$", () => {
	it("keeps only configured account types", async () => {
		const wallet = createMockInjectedWallet([
			{
				address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
				name: "Alice",
				type: "sr25519",
				genesisHash: null,
				polkadotSigner: {} as never,
			},
			{
				address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
				name: "Eth Key",
				type: "ethereum",
				genesisHash: null,
				polkadotSigner: {} as never,
			},
		]);

		const accounts = await firstValueFrom(
			getPolkadotAccounts$(of([wallet]), ["sr25519", "ed25519", "ecdsa"]),
		);

		expect(accounts).toHaveLength(1);
		expect(accounts[0]?.type).toBe("sr25519");
		expect(accounts[0]?.walletId).toBe(wallet.id);
	});

	it("includes ethereum polkadot accounts when explicitly configured", async () => {
		const wallet = createMockInjectedWallet([
			{
				address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
				name: "Ethereum Key",
				type: "ethereum",
				genesisHash: null,
				polkadotSigner: {} as never,
			},
		]);

		const accounts = await firstValueFrom(
			getPolkadotAccounts$(of([wallet]), ["ethereum"]),
		);

		expect(accounts).toHaveLength(1);
		expect(accounts[0]?.type).toBe("ethereum");
	});

	it("returns no accounts and warns when allowlist is empty", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const wallet = createMockInjectedWallet([
			{
				address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
				name: "Alice",
				type: "sr25519",
				genesisHash: null,
				polkadotSigner: {} as never,
			},
		]);

		const accounts = await firstValueFrom(
			getPolkadotAccounts$(of([wallet]), []),
		);

		expect(accounts).toEqual([]);
		expect(warnSpy).toHaveBeenCalledWith(
			"[kheopskit] config.polkadotAccountTypes is empty; all Polkadot accounts will be filtered out.",
		);
		warnSpy.mockRestore();
	});
});
