import type { KheopskitPlatform, PlatformContext } from "../types";
import { getSolanaAccounts$ } from "./accounts";
import {
	DEFAULT_SOLANA_CHAIN,
	isSolanaChainId,
	type SolanaChainId,
} from "./chains";
import type { SolanaAccount, SolanaWallet } from "./types";
import { getSolanaWallets$ } from "./wallets";

export type SolanaPluginOptions = {
	/**
	 * Solana cluster that account signers target. Each account also exposes a
	 * `getSigner(chain)` factory for targeting another cluster.
	 *
	 * @default "solana:mainnet"
	 */
	chain?: SolanaChainId;
};

/**
 * Solana platform plugin. Pass to `getKheopskit$({ platforms: [solana()] })`.
 *
 * @example
 * ```ts
 * import { solana } from "@kheopskit/core/solana";
 * solana({ chain: "solana:mainnet" });
 * ```
 */
export const solana = (
	options: SolanaPluginOptions = {},
): KheopskitPlatform<"solana", SolanaWallet, SolanaAccount> => {
	const chain = options.chain ?? DEFAULT_SOLANA_CHAIN;

	if (!isSolanaChainId(chain)) {
		console.warn(
			`[kheopskit] Unknown solana chain: ${JSON.stringify(chain)}. Valid values: "solana:mainnet", "solana:devnet", "solana:testnet", "solana:localnet".`,
		);
	}

	return {
		platform: "solana",
		getWallets$: (ctx: PlatformContext) => getSolanaWallets$(ctx.store),
		getAccounts$: (wallets$) => getSolanaAccounts$(wallets$, chain),
	};
};
