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
	/**
	 * Stable identifier of the underlying wallet source. For Ethereum this is the
	 * EIP-6963 `rdns`. Named consistently across platforms (Solana: Wallet
	 * Standard name; Polkadot: extension identifier).
	 */
	sourceId: string;
	provider: EIP1193Provider;
	name: string;
	icon: string;
	isConnected: boolean;
	connect: () => Promise<void>;
	disconnect: () => Promise<void>;
};

export type EthereumWallet = EthereumInjectedWallet | EthereumAppKitWallet;

export type EthereumAccount = {
	id: WalletAccountId;
	platform: "ethereum";
	/**
	 * Signing surface for this account: a viem {@link WalletClient} bound to the
	 * wallet's provider (sign/send via viem actions). Per-platform signing
	 * surfaces differ — Solana exposes `signer`/`getSigner(chain)`, Polkadot
	 * exposes `polkadotSigner`. Absent while `state.isHydrating` is `true`.
	 */
	client: WalletClient<CustomTransport, undefined, Account, undefined>;
	address: `0x${string}`;
	/** Current chain ID the wallet is connected to. `undefined` while loading or after provider disconnect. */
	chainId: number | undefined;
	walletName: string;
	walletId: WalletId;
};
