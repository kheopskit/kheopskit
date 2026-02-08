import type { AppKit, ThemeMode, ThemeVariables } from "@reown/appkit/core";
import type { AppKitNetwork } from "@reown/appkit/networks";
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

export type KheopskitConfig = {
	autoReconnect: boolean;
	platforms: WalletPlatform[];
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

export type Wallet = PolkadotWallet | EthereumWallet;

export type WalletPlatform = Wallet["platform"];

export type PolkadotAccount = InjectedPolkadotAccount & {
	id: WalletAccountId;
	platform: "polkadot";
	walletName: string;
	walletId: string;
};

export type EthereumAccount = {
	id: WalletAccountId;
	platform: "ethereum";
	client: WalletClient<CustomTransport, undefined, Account, undefined>; // let consumer knows chain is unknown
	address: `0x${string}`;
	walletName: string;
	walletId: string;
	isWalletDefault: boolean;
};

export type WalletAccount = PolkadotAccount | EthereumAccount;

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
	walletId: WalletId;
	walletName: string;
};
