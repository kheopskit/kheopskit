import type { AppKit, ThemeMode, ThemeVariables } from "@reown/appkit/core";
import type { AppKitNetwork } from "@reown/appkit/networks";
import type {
	MessageModifyingSigner,
	TransactionModifyingSigner,
	TransactionSendingSigner,
} from "@solana/kit";
import type { Wallet as WalletStandardWallet } from "@wallet-standard/base";
import type { Metadata } from "@walletconnect/universal-provider";
import type {
	InjectedExtension,
	InjectedPolkadotAccount,
} from "polkadot-api/pjs-signer";
import type {
	Account,
	CustomTransport,
	EIP1193Provider,
	WalletClient,
} from "viem";
import type { WalletAccountId } from "../utils";
import type { WalletId } from "../utils/WalletId";
import type { SolanaChainId } from "./solana/chains";

export type KheopskitConfig = {
	autoReconnect: boolean;
	platforms: WalletPlatform[];
	/**
	 * Allowed Polkadot account key types.
	 * Accounts with other key types are filtered out from kheopskit state.
	 *
	 * @default ["sr25519", "ed25519", "ecdsa"]
	 */
	polkadotAccountTypes: PolkadotAccountType[];
	/**
	 * Solana cluster that account signers target.
	 *
	 * Each Solana account exposes a `signer` pre-bound to this chain, plus a
	 * `getSigner(chain)` factory for dapps that need to target another cluster.
	 *
	 * @default "solana:mainnet"
	 */
	solanaChain: SolanaChainId;
	walletConnect?: {
		projectId: string;
		metadata: Metadata;
		/** Defaults to wss://relay.walletconnect.com */
		relayUrl?: string;
		/**
		 * list of CAIP-13 ids of polkadot-sdk chains
		 * see https://docs.reown.com/advanced/multichain/polkadot/dapp-integration-guide#walletconnect-code%2Fcomponent-setup
		 */
		networks: [AppKitNetwork, ...AppKitNetwork[]];
		themeMode?: ThemeMode;
		themeVariables?: ThemeVariables;
	};
	debug: boolean;
	/**
	 * Custom storage key for persisting wallet connection state.
	 * Useful when running multiple kheopskit instances on the same domain
	 * to prevent state conflicts between different dapps.
	 *
	 * @default "kheopskit"
	 *
	 * @example
	 * ```ts
	 * // For app "MyDapp" to avoid conflicts
	 * { storageKey: "kheopskit-mydapp" }
	 * ```
	 */
	storageKey: string;
	/**
	 * Grace period in milliseconds to wait for wallets to inject before
	 * syncing to actual state. During this period, cached wallet/account
	 * state from storage is preserved to prevent UI flashing.
	 *
	 * Set to 0 to disable hydration buffering.
	 *
	 * @default 500
	 */
	hydrationGracePeriod: number;
};

export type PolkadotInjectedWallet = {
	id: WalletId;
	platform: "polkadot";
	type: "injected";
	extensionId: string;
	extension: InjectedExtension | undefined;
	name: string;
	icon: string;
	isConnected: boolean;
	connect: () => Promise<void>;
	disconnect: () => void;
};

export type PolkadotAppKitWallet = {
	id: WalletId;
	platform: "polkadot";
	type: "appKit";
	appKit: AppKit;
	name: string;
	icon: string;
	isConnected: boolean;
	connect: () => Promise<void>;
	disconnect: () => void;
};

export type PolkadotWallet = PolkadotInjectedWallet | PolkadotAppKitWallet;

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

export type EthereumAppKitWallet = {
	platform: "ethereum";
	type: "appKit";
	id: WalletId;
	appKit: AppKit;
	name: string;
	icon: string;
	isConnected: boolean;
	connect: () => Promise<void>;
	disconnect: () => void;
};

export type EthereumWallet = EthereumInjectedWallet | EthereumAppKitWallet;

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

export type SolanaAppKitWallet = {
	platform: "solana";
	type: "appKit";
	id: WalletId;
	appKit: AppKit;
	name: string;
	icon: string;
	isConnected: boolean;
	connect: () => Promise<void>;
	disconnect: () => void;
};

export type SolanaWallet = SolanaInjectedWallet | SolanaAppKitWallet;

export type Wallet = PolkadotWallet | EthereumWallet | SolanaWallet;

export type WalletPlatform = Wallet["platform"];

export type PolkadotAccountType = "sr25519" | "ed25519" | "ecdsa" | "ethereum";

export type PolkadotAccount = Omit<InjectedPolkadotAccount, "type"> & {
	type: PolkadotAccountType;
	id: WalletAccountId;
	platform: "polkadot";
	walletName: string;
	walletId: string;
};

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

export type SolanaAccount = {
	id: WalletAccountId;
	platform: "solana";
	/** Base58-encoded address. */
	address: string;
	/** Solana clusters advertised by the wallet for this account. */
	chains: SolanaChainId[];
	/** Signer bound to `config.solanaChain`. */
	signer: SolanaSigner;
	/** Returns a signer bound to an arbitrary cluster. */
	getSigner: (chain: SolanaChainId) => SolanaSigner;
	walletName: string;
	walletId: string;
	isWalletDefault: boolean;
};

export type WalletAccount = PolkadotAccount | EthereumAccount | SolanaAccount;

/**
 * Serializable wallet data for SSR hydration cache.
 * Contains only the data needed to render wallet UI without flash.
 * Note: icon is NOT stored to save cookie space - it's looked up at hydration time.
 */
export type CachedWallet = {
	id: WalletId;
	platform: WalletPlatform;
	type: "injected" | "appKit";
	name: string;
	isConnected: boolean;
};

/**
 * Serializable account data for SSR hydration cache.
 * Contains only the data needed to render account UI without flash.
 */
export type CachedAccount = {
	id: string;
	platform: WalletPlatform;
	address: string;
	name?: string;
	/** Cached chain ID for Ethereum accounts. */
	chainId?: number;
	/** Cached key type for Polkadot accounts. */
	polkadotAccountType?: PolkadotAccountType;
	walletId: WalletId;
	walletName: string;
};

export type { SolanaChainId };
