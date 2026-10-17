import { describe, expect, it } from "vitest";
import type { PolkadotAccount } from "../api/polkadot/types";
import type { CachedAccount, CachedWallet } from "../api/types";
import {
	hydrateAccount,
	hydrateWallet,
	serializeAccount,
} from "./hydrateState";
import type { WalletAccountId } from "./WalletAccountId";
import type { WalletId } from "./WalletId";

const WALLET_ID = "polkadot:talisman" as WalletId;
const ACCOUNT_ID =
	"polkadot:talisman::5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" as WalletAccountId;
const ADDRESS = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

describe("hydrateAccount", () => {
	it("carries the base fields plus the polkadot key type from cache", () => {
		const cached: CachedAccount = {
			id: ACCOUNT_ID,
			platform: "polkadot",
			address: ADDRESS,
			name: "Alice",
			polkadotAccountType: "ethereum",
			walletId: WALLET_ID,
			walletName: "Talisman",
		};

		expect(hydrateAccount(cached)).toEqual({
			id: ACCOUNT_ID,
			isPlaceholder: true,
			platform: "polkadot",
			address: ADDRESS,
			name: "Alice",
			// plain serializable data is preserved so reload renders it immediately
			type: "ethereum",
			walletId: WALLET_ID,
			walletName: "Talisman",
		});
	});

	it("carries the ethereum chainId from cache", () => {
		const cached: CachedAccount = {
			id: "ethereum:metamask::0xabc" as WalletAccountId,
			platform: "ethereum",
			address: "0xabc",
			chainId: 137,
			walletId: "ethereum:metamask" as WalletId,
			walletName: "MetaMask",
		};

		const account = hydrateAccount(cached) as typeof cached & {
			chainId?: number;
		};
		expect(account.chainId).toBe(137);
		expect(account.platform).toBe("ethereum");
	});

	it("does not invent platform fields the cache lacks", () => {
		const cached: CachedAccount = {
			id: "ethereum:metamask::0xabc" as WalletAccountId,
			platform: "ethereum",
			address: "0xabc",
			// chainId unknown when cached
			walletId: "ethereum:metamask" as WalletId,
			walletName: "MetaMask",
		};

		const account = hydrateAccount(cached) as Record<string, unknown>;
		expect(account.chainId).toBeUndefined();
		// the polkadot-only field is never present on an ethereum placeholder
		expect("type" in account).toBe(false);
	});
});

const SDK_FIELDS = [
	"txCreator",
	"polkadotSigner",
	"client",
	"signer",
	"getSigner",
	"signRaw",
	"extension",
	"provider",
	"wallet",
	"appKit",
	"sourceId",
];

const sdkFieldsOf = (item: object) =>
	SDK_FIELDS.filter((field) => field in item);

describe("placeholders", () => {
	const cachedWallets: CachedWallet[] = [
		{
			id: WALLET_ID,
			platform: "polkadot",
			type: "injected",
			name: "Talisman",
			isConnected: true,
		},
		{
			id: "ethereum:io.metamask" as WalletId,
			platform: "ethereum",
			type: "injected",
			name: "MetaMask",
			isConnected: false,
		},
		{
			id: "walletconnect" as WalletId,
			type: "walletconnect",
			name: "WalletConnect",
			isConnected: true,
		},
	];
	const cachedAccounts: CachedAccount[] = [
		{
			id: ACCOUNT_ID,
			platform: "polkadot",
			address: ADDRESS,
			polkadotAccountType: "sr25519",
			walletId: WALLET_ID,
			walletName: "Talisman",
		},
		{
			id: "ethereum:io.metamask::0xabc",
			platform: "ethereum",
			address: "0xabc",
			chainId: 1,
			walletId: "ethereum:io.metamask" as WalletId,
			walletName: "MetaMask",
		},
		{
			id: "solana:Phantom::So11111111111111111111111111111111111111112",
			platform: "solana",
			address: "So11111111111111111111111111111111111111112",
			walletId: "solana:Phantom" as WalletId,
			walletName: "Phantom",
		},
	];

	it("hydrateWallet flags every wallet and carries no SDK field", () => {
		const wallets = cachedWallets.map(hydrateWallet);
		expect(wallets.map((w) => [w.id, w.isPlaceholder, w.isConnected])).toEqual([
			[WALLET_ID, true, false],
			["ethereum:io.metamask", true, false],
			["walletconnect", true, false],
		]);
		expect(wallets.map(sdkFieldsOf)).toEqual([[], [], []]);
	});

	it("hydrateAccount flags every account and carries no SDK field", () => {
		const accounts = cachedAccounts.map(hydrateAccount);
		expect(accounts.map((a) => [a.platform, a.isPlaceholder])).toEqual([
			["polkadot", true],
			["ethereum", true],
			["solana", true],
		]);
		expect(accounts.map(sdkFieldsOf)).toEqual([[], [], []]);
		expect(accounts[2]).toMatchObject({ chains: [] });
	});

	it("a placeholder's connect rejects with WALLET_PENDING and its disconnect resolves", async () => {
		for (const wallet of cachedWallets.map(hydrateWallet)) {
			await expect(wallet.connect()).rejects.toMatchObject({
				code: "WALLET_PENDING",
				walletId: wallet.id,
			});
			await expect(wallet.disconnect()).resolves.toBeUndefined();
		}
	});
});

describe("serializeAccount (polkadot cached type)", () => {
	it("stores polkadotAccountType for polkadot accounts", () => {
		const account: PolkadotAccount = {
			id: ACCOUNT_ID,
			platform: "polkadot",
			type: "ecdsa",
			address: ADDRESS,
			name: "Alice",
			genesisHash: null,
			walletId: WALLET_ID,
			walletName: "Talisman",
			txCreator: {} as never,
			signRaw: {} as never,
		};

		const cached = serializeAccount(account);

		expect(cached.platform).toBe("polkadot");
		expect(cached.polkadotAccountType).toBe("ecdsa");
	});
});
