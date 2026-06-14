import { describe, expect, it } from "vitest";
import type { PolkadotAccount } from "../api/polkadot/types";
import type { CachedAccount } from "../api/types";
import { hydrateAccount, serializeAccount } from "./hydrateState";
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
			polkadotSigner: {} as never,
		};

		const cached = serializeAccount(account);

		expect(cached.platform).toBe("polkadot");
		expect(cached.polkadotAccountType).toBe("ecdsa");
	});
});
