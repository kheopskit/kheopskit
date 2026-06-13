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
	it("returns the SDK-free base account shape", () => {
		const cached: CachedAccount = {
			id: ACCOUNT_ID,
			platform: "polkadot",
			address: ADDRESS,
			name: "Alice",
			// platform-only fields are not carried onto the base placeholder
			polkadotAccountType: "ethereum",
			walletId: WALLET_ID,
			walletName: "Talisman",
		};

		expect(hydrateAccount(cached)).toEqual({
			id: ACCOUNT_ID,
			platform: "polkadot",
			address: ADDRESS,
			name: "Alice",
			walletId: WALLET_ID,
			walletName: "Talisman",
		});
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
