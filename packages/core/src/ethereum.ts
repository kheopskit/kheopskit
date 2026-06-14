export { ethereum } from "./api/ethereum/plugin";
export type {
	EthereumAccount,
	EthereumInjectedWallet,
	EthereumWallet,
} from "./api/ethereum/types";
export {
	isInjectedWallet,
	isWalletConnectWallet,
	type WalletConnectWallet,
} from "./api/types";
export { isEthereumAddress } from "./utils/isEthereumAddress";
