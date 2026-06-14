import type {
	KheopskitPlatform,
	PlatformContext,
	PolkadotAccountType,
} from "../types";
import { getPolkadotAccounts$ } from "./accounts";
import type { PolkadotAccount, PolkadotWallet } from "./types";
import { getPolkadotWallets$ } from "./wallets";

const DEFAULT_ACCOUNT_TYPES: PolkadotAccountType[] = [
	"sr25519",
	"ed25519",
	"ecdsa",
];

const VALID_ACCOUNT_TYPES = new Set<string>([
	"sr25519",
	"ed25519",
	"ecdsa",
	"ethereum",
]);

export type PolkadotPluginOptions = {
	/**
	 * Allowed Polkadot account key types. Accounts with other key types are
	 * filtered out from kheopskit state.
	 *
	 * @default ["sr25519", "ed25519", "ecdsa"]
	 */
	accountTypes?: PolkadotAccountType[];
};

/**
 * Polkadot platform plugin. Pass to `getKheopskit$({ platforms: [polkadot()] })`.
 *
 * @example
 * ```ts
 * import { polkadot } from "@kheopskit/core/polkadot";
 * polkadot({ accountTypes: ["sr25519", "ed25519", "ecdsa"] });
 * ```
 */
export const polkadot = (
	options: PolkadotPluginOptions = {},
): KheopskitPlatform<"polkadot", PolkadotWallet, PolkadotAccount> => {
	const accountTypes = options.accountTypes ?? DEFAULT_ACCOUNT_TYPES;

	const invalid = accountTypes.filter((t) => !VALID_ACCOUNT_TYPES.has(t));
	if (invalid.length > 0) {
		console.warn(
			`[kheopskit] Unknown polkadot accountTypes: ${JSON.stringify(invalid)}. Valid values: "sr25519", "ed25519", "ecdsa", "ethereum".`,
		);
	}

	return {
		platform: "polkadot",
		getWallets$: (ctx: PlatformContext) =>
			getPolkadotWallets$(ctx.config, ctx.store),
		getAccounts$: (wallets$) => getPolkadotAccounts$(wallets$, accountTypes),
		acceptsCachedAccount: (cached) =>
			accountTypes.includes(cached.polkadotAccountType ?? "sr25519"),
	};
};
