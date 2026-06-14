import type { KheopskitPlatform, PlatformContext } from "../types";
import { getEthereumAccounts$ } from "./accounts";
import type { EthereumAccount, EthereumWallet } from "./types";
import { getEthereumWallets$ } from "./wallets";

/**
 * Ethereum platform plugin. Pass to `getKheopskit$({ platforms: [ethereum()] })`.
 *
 * @example
 * ```ts
 * import { ethereum } from "@kheopskit/core/ethereum";
 * ethereum();
 * ```
 */
export const ethereum = (): KheopskitPlatform<
	"ethereum",
	EthereumWallet,
	EthereumAccount
> => ({
	platform: "ethereum",
	getWallets$: (ctx: PlatformContext) => getEthereumWallets$(ctx.store),
	getAccounts$: (wallets$) => getEthereumAccounts$(wallets$),
});
