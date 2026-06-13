import type { AppKit, ThemeMode, ThemeVariables } from "@reown/appkit/core";
import type { AppKitNetwork } from "@reown/appkit/networks";
import type { Metadata } from "@walletconnect/universal-provider";
import type { Observable } from "rxjs";
import type { WalletAccountId } from "../utils";
import type { WalletId } from "../utils/WalletId";
import type { KheopskitStore } from "./store";

export type WalletPlatform = "polkadot" | "ethereum" | "solana";

export type WalletType = "injected" | "appKit";

export type PolkadotAccountType = "sr25519" | "ed25519" | "ecdsa" | "ethereum";

/**
 * SDK-free fields common to every wallet, regardless of platform. Platform
 * packages (`@kheopskit/core/<platform>`) extend this with SDK-typed fields
 * (the injected provider/extension/standard-wallet handle).
 */
export type BaseWallet = {
	id: WalletId;
	platform: WalletPlatform;
	type: WalletType;
	name: string;
	icon: string;
	isConnected: boolean;
	connect: () => Promise<void>;
	disconnect: () => void;
};

/**
 * SDK-free fields common to every account, regardless of platform. Platform
 * packages extend this with their SDK-typed signer/client.
 */
export type BaseWalletAccount = {
	id: WalletAccountId;
	platform: WalletPlatform;
	/** Base58 (Solana), SS58 (Polkadot) or 0x-hex (Ethereum) address. */
	address: string;
	/** Friendly account name, when the wallet exposes one (e.g. Polkadot). */
	name?: string;
	walletName: string;
	walletId: string;
};

/**
 * AppKit (WalletConnect) wallet handles. These reference only `@reown/appkit`
 * (a hard dependency) — no optional platform SDK — so they live in core and are
 * shared by every platform's wallet union.
 */
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

export type EthereumAppKitWallet = {
	id: WalletId;
	platform: "ethereum";
	type: "appKit";
	appKit: AppKit;
	name: string;
	icon: string;
	isConnected: boolean;
	connect: () => Promise<void>;
	disconnect: () => void;
};

export type SolanaAppKitWallet = {
	id: WalletId;
	platform: "solana";
	type: "appKit";
	appKit: AppKit;
	name: string;
	icon: string;
	isConnected: boolean;
	connect: () => Promise<void>;
	disconnect: () => void;
};

export type WalletConnectConfig = {
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

/**
 * Context passed to a platform plugin's `getWallets$`. Carries the shared store
 * and the resolved core config (for WalletConnect / debug).
 */
export type PlatformContext = {
	store: KheopskitStore;
	config: KheopskitConfig;
};

/**
 * A platform plugin. Created by the per-platform factories exported from
 * `@kheopskit/core/polkadot`, `/ethereum`, `/solana`. Core iterates plugins
 * generically and never imports a platform SDK itself.
 *
 * @typeParam TPlatform - the platform discriminant
 * @typeParam TWallet - the platform's wallet type (extends {@link BaseWallet})
 * @typeParam TAccount - the platform's account type (extends {@link BaseWalletAccount})
 */
export type KheopskitPlatform<
	TPlatform extends WalletPlatform = WalletPlatform,
	TWallet extends BaseWallet = BaseWallet,
	TAccount extends BaseWalletAccount = BaseWalletAccount,
> = {
	readonly platform: TPlatform;
	// Declared as methods (not arrow properties) so parameters are checked
	// bivariantly — this lets a specific `KheopskitPlatform<"polkadot", …>` be
	// assigned to the base `KheopskitPlatform` despite the contravariant
	// `wallets$` parameter.
	getWallets$(ctx: PlatformContext): Observable<TWallet[]>;
	getAccounts$(wallets$: Observable<TWallet[]>): Observable<TAccount[]>;
	/**
	 * Optional hydration filter. Cached accounts for which this returns false are
	 * dropped during SSR hydration (Polkadot uses it to honour `accountTypes`).
	 */
	acceptsCachedAccount?(cached: CachedAccount): boolean;
};

type ElementOf<T> = T extends readonly (infer E)[] ? E : never;

/** The account type produced by a plugin (inferred from its `getAccounts$`). */
export type AccountOf<T> = T extends {
	getAccounts$: (wallets$: never) => Observable<infer R>;
}
	? ElementOf<R>
	: never;

/** The wallet type produced by a plugin (inferred from its `getWallets$`). */
export type WalletOf<T> = T extends {
	getWallets$: (ctx: never) => Observable<infer R>;
}
	? ElementOf<R>
	: never;

export type KheopskitConfig<
	P extends readonly KheopskitPlatform[] = readonly KheopskitPlatform[],
> = {
	autoReconnect: boolean;
	/**
	 * Platform plugins to enable, e.g. `[polkadot(), solana({ chain })]`.
	 * Import factories from `@kheopskit/core/<platform>`.
	 */
	platforms: P;
	walletConnect?: WalletConnectConfig;
	debug: boolean;
	/**
	 * Custom storage key for persisting wallet connection state.
	 * Useful when running multiple kheopskit instances on the same domain
	 * to prevent state conflicts between different dapps.
	 *
	 * @default "kheopskit"
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

export type KheopskitState<
	P extends readonly KheopskitPlatform[] = readonly KheopskitPlatform[],
> = {
	wallets: WalletOf<P[number]>[];
	accounts: AccountOf<P[number]>[];
	config: KheopskitConfig<P>;
	/**
	 * Whether the state is still being hydrated from cache.
	 * During hydration, cached wallets/accounts may be displayed
	 * before the actual wallet extensions have injected.
	 */
	isHydrating: boolean;
};

/**
 * Serializable wallet data for SSR hydration cache.
 * Contains only the data needed to render wallet UI without flash.
 * Note: icon is NOT stored to save cookie space - it's looked up at hydration time.
 */
export type CachedWallet = {
	id: WalletId;
	platform: WalletPlatform;
	type: WalletType;
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
