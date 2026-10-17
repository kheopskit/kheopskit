import type {
	MessageModifyingSigner,
	TransactionModifyingSigner,
	TransactionSendingSigner,
} from "@solana/kit";
import type { Wallet as WalletStandardWallet } from "@wallet-standard/base";
import type { WalletAccountId } from "../../utils/WalletAccountId";
import type { WalletId } from "../../utils/WalletId";
import type { BaseWallet, Placeholder, PlaceholderWallet } from "../types";
import type { SolanaChainId } from "./chains";

/**
 * Unified signing interface for Solana accounts, expressed with @solana/kit
 * signer interfaces so it plugs directly into kit's transaction pipeline
 * (e.g. `signAndSendTransactionMessageWithSigners`).
 */
export type SolanaSigner = MessageModifyingSigner &
	TransactionModifyingSigner &
	TransactionSendingSigner;

type LiveSolanaInjectedWallet = {
	isPlaceholder?: false;
	platform: "solana";
	type: "injected";
	id: WalletId;
	/**
	 * Stable identifier of the underlying wallet source. For Solana this is the
	 * Wallet Standard wallet name. Named consistently across platforms (Ethereum:
	 * EIP-6963 rdns; Polkadot: extension identifier).
	 */
	sourceId: string;
	/** Raw Wallet Standard wallet, exposed as an escape hatch. */
	wallet: WalletStandardWallet;
	/** Solana clusters advertised by the wallet. */
	chains: SolanaChainId[];
	name: string;
	icon: string;
	status: BaseWallet["status"];
	error?: BaseWallet["error"];
	isConnected: boolean;
	connect: BaseWallet["connect"];
	disconnect: BaseWallet["disconnect"];
};

export type SolanaInjectedWallet =
	| LiveSolanaInjectedWallet
	| PlaceholderWallet<
			LiveSolanaInjectedWallet,
			"sourceId" | "wallet" | "chains"
	  >;

export type SolanaWallet = SolanaInjectedWallet;

type LiveSolanaAccount = {
	isPlaceholder?: false;
	id: WalletAccountId;
	platform: "solana";
	/** Base58-encoded address. */
	address: string;
	/** Solana clusters advertised by the wallet for this account. */
	chains: SolanaChainId[];
	/** Signer bound to the configured cluster. */
	signer: SolanaSigner;
	/** Returns a signer bound to an arbitrary cluster. */
	getSigner: (chain: SolanaChainId) => SolanaSigner;
	walletName: string;
	walletId: WalletId;
};

export type SolanaAccount =
	| LiveSolanaAccount
	| Placeholder<LiveSolanaAccount, "signer" | "getSigner">;
