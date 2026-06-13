import type {
	MessageModifyingSigner,
	TransactionModifyingSigner,
	TransactionSendingSigner,
} from "@solana/kit";
import type { Wallet as WalletStandardWallet } from "@wallet-standard/base";
import type { WalletAccountId } from "../../utils/WalletAccountId";
import type { WalletId } from "../../utils/WalletId";
import type { SolanaAppKitWallet } from "../types";
import type { SolanaChainId } from "./chains";

/**
 * Unified signing interface for Solana accounts, expressed with @solana/kit
 * signer interfaces so it plugs directly into kit's transaction pipeline
 * (e.g. `signAndSendTransactionMessageWithSigners`).
 */
export type SolanaSigner = MessageModifyingSigner &
	TransactionModifyingSigner &
	TransactionSendingSigner;

export type SolanaInjectedWallet = {
	platform: "solana";
	type: "injected";
	id: WalletId;
	walletStandardId: string;
	/** Raw Wallet Standard wallet, exposed as an escape hatch. */
	wallet: WalletStandardWallet;
	/** Solana clusters advertised by the wallet. */
	chains: SolanaChainId[];
	name: string;
	icon: string;
	isConnected: boolean;
	connect: () => Promise<void>;
	disconnect: () => void;
};

export type SolanaWallet = SolanaInjectedWallet | SolanaAppKitWallet;

export type SolanaAccount = {
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
	walletId: string;
	isWalletDefault: boolean;
};
