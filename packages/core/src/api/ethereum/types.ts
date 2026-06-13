import type {
	Account,
	CustomTransport,
	EIP1193Provider,
	WalletClient,
} from "viem";
import type { WalletAccountId } from "../../utils/WalletAccountId";
import type { WalletId } from "../../utils/WalletId";
import type { EthereumAppKitWallet } from "../types";

export type EthereumInjectedWallet = {
	platform: "ethereum";
	type: "injected";
	id: WalletId;
	providerId: string;
	provider: EIP1193Provider;
	name: string;
	icon: string;
	isConnected: boolean;
	connect: () => Promise<void>;
	disconnect: () => void;
};

export type EthereumWallet = EthereumInjectedWallet | EthereumAppKitWallet;

export type EthereumAccount = {
	id: WalletAccountId;
	platform: "ethereum";
	client: WalletClient<CustomTransport, undefined, Account, undefined>;
	address: `0x${string}`;
	/** Current chain ID the wallet is connected to. `undefined` while loading or after provider disconnect. */
	chainId: number | undefined;
	walletName: string;
	walletId: string;
	isWalletDefault: boolean;
};
