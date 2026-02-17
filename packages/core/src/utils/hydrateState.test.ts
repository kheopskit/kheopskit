import { describe, expect, it } from "vitest";
import type { CachedAccount, PolkadotAccount } from "../api/types";
import { hydrateAccount, serializeAccount } from "./hydrateState";
import type { WalletAccountId } from "./WalletAccountId";
import type { WalletId } from "./WalletId";

const WALLET_ID = "polkadot:talisman" as WalletId;
const ACCOUNT_ID =
	"polkadot:talisman::5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" as WalletAccountId;
const ADDRESS = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

describe("hydrateAccount (polkadot cached type)", () => {
	it("uses cached polkadotAccountType when provided", () => {
		const cached: CachedAccount = {
			id: ACCOUNT_ID,
			platform: "polkadot",
			address: ADDRESS,
			polkadotAccountType: "ethereum",
			walletId: WALLET_ID,
			walletName: "Talisman",
		};

		const hydrated = hydrateAccount(cached);

		expect(hydrated.platform).toBe("polkadot");
		if (hydrated.platform !== "polkadot") {
			throw new Error("expected polkadot account");
		}
		expect(hydrated.type).toBe("ethereum");
	});

	it("falls back to sr25519 for legacy cached accounts without type", () => {
		const cached: CachedAccount = {
			id: ACCOUNT_ID,
			platform: "polkadot",
			address: ADDRESS,
			walletId: WALLET_ID,
			walletName: "Talisman",
		};

		const hydrated = hydrateAccount(cached);

		expect(hydrated.platform).toBe("polkadot");
		if (hydrated.platform !== "polkadot") {
			throw new Error("expected polkadot account");
		}
		expect(hydrated.type).toBe("sr25519");
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
