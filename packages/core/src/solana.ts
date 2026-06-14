export {
	DEFAULT_SOLANA_CHAIN,
	getSolanaCaip2,
	isSolanaChainId,
	type SolanaChainId,
} from "./api/solana/chains";
export { type SolanaPluginOptions, solana } from "./api/solana/plugin";
export type {
	SolanaAccount,
	SolanaInjectedWallet,
	SolanaSigner,
	SolanaWallet,
} from "./api/solana/types";
export {
	isInjectedWallet,
	isWalletConnectWallet,
	type WalletConnectWallet,
} from "./api/types";
export { isSolanaAddress } from "./utils/isSolanaAddress";
