import type { Observable } from "rxjs";
import type { WalletAccountId } from "../utils";
import type { WalletId } from "../utils/WalletId";
import type { KheopskitError } from "./errors";

export type WalletPlatform = "polkadot" | "ethereum" | "solana";

/**
 * Minimal structural view of a WalletConnect `UniversalProvider` — the subset
 * kheopskit reads. Declared locally so core never depends on
 * `@walletconnect/universal-provider`. The concrete instance comes from
 * `@reown/appkit` at runtime.
 */
export type WalletConnectProvider = {
	session?: {
		topic: string;
		namespaces: Record<string, { accounts?: string[] }>;
	};
	client: {
		request<T = unknown>(args: {
			topic: string;
			chainId: string;
			request: { method: string; params: unknown };
		}): Promise<T>;
	};
	request(args: { method: string; params?: unknown }): Promise<unknown>;
	on(event: string, listener: (...args: unknown[]) => void): void;
	off(event: string, listener: (...args: unknown[]) => void): void;
};

/**
 * Minimal structural view of the Reown AppKit instance — the subset kheopskit's
 * account factories use. Exposed as the `appKit` escape hatch on AppKit wallets;
 * cast it to `@reown/appkit`'s `AppKit` type for the full API. Declared locally
 * so core never depends on `@reown/appkit`'s types (it's an optional peer).
 */
export type AppKitInstance = {
	getProvider<T = WalletConnectProvider>(namespace: string): T | undefined;
	getAccount(
		namespace: string,
	): { allAccounts: { address: string }[] } | undefined;
	getCaipNetworks(namespace: string): { caipNetworkId?: string }[];
};

export type WalletType = "injected" | "walletconnect";

/**
 * Where a wallet stands with the dapp. `connecting` covers a `connect()` call
 * in flight and an auto-reconnect in flight alike.
 */
export type WalletStatus = "disconnected" | "connecting" | "connected";

export type PolkadotAccountType = "sr25519" | "ed25519" | "ecdsa" | "ethereum";

/** Options accepted by {@link BaseWallet.connect}. */
export type ConnectOptions = {
	/**
	 * Ends this caller's wait for the platform's answer: its promise rejects
	 * with a `KheopskitError` of code `ABORTED`. An abort after the platform
	 * has granted the connect changes nothing. Other callers sharing the
	 * attempt keep waiting. Once no caller waits any more, a handle the
	 * platform hands back afterwards is released and the wallet is neither
	 * connected nor remembered. The
	 * extension's own prompt may stay open: nothing can withdraw it from the
	 * page. Kheopskit sets no timeout of its own, because an extension prompt
	 * pends only while the user has not answered it; pass
	 * `AbortSignal.timeout(ms)` to cap the wait.
	 */
	signal?: AbortSignal;
};

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
	/**
	 * `connecting` while a `connect()` call or an auto-reconnect waits for the
	 * platform, `connected` once the platform granted it, `disconnected`
	 * otherwise. On a reload, a remembered wallet kheopskit will reconnect is
	 * `connecting` from the first frame.
	 */
	status: WalletStatus;
	/**
	 * The last `connect()` or auto-reconnect that the platform refused or
	 * failed (`USER_REJECTED` or `CONNECT_FAILED`). Cleared when the next
	 * attempt starts. An aborted attempt sets nothing.
	 */
	error?: KheopskitError;
	/** `status === "connected"`. */
	isConnected: boolean;
	/**
	 * Connects the wallet.
	 *
	 * - **Shared in flight.** Concurrent calls on one wallet share a single
	 *   platform attempt and the platform is asked once. Each call gets its own
	 *   promise: aborting a caller's `signal` rejects only that caller with code
	 *   `ABORTED`. The attempt itself is abandoned only when every caller that
	 *   passed a signal has aborted and no caller without one joined, when
	 *   `disconnect()` is called, or when the last `kheopskit$` subscriber
	 *   unsubscribes; those reject every remaining caller with `ABORTED`.
	 * - **Idempotent.** On a connected wallet it resolves at once without
	 *   touching the platform.
	 * - **Abortable.** See {@link ConnectOptions.signal}. There is no default
	 *   timeout.
	 * - **Settles with the state.** It resolves only after `kheopskit$` has
	 *   emitted a state in which this wallet has `isConnected: true`, so the
	 *   consumer-visible state already reflects the connect. On platforms that
	 *   list accounts asynchronously (Ethereum `eth_accounts`), the accounts may
	 *   arrive in a later emission; no emission shows a connected wallet with a
	 *   previous connection's accounts, or a disconnected wallet still listing
	 *   accounts. A `disconnect()` call made while it waits
	 *   for that state rejects it with `ABORTED`. Once the last `kheopskit$`
	 *   subscriber has unsubscribed, a call on a wallet object from that
	 *   subscription rejects with `ABORTED` without asking the platform.
	 * - **Typed rejections.** A platform rejection is wrapped in a
	 *   `KheopskitError` carrying the original error as `cause` and the
	 *   `walletId`: `USER_REJECTED` when the user refused the prompt,
	 *   `CONNECT_FAILED` otherwise.
	 */
	connect: (options?: ConnectOptions) => Promise<void>;
	/**
	 * Disconnects the wallet.
	 *
	 * On a disconnected wallet it resolves at once. While a `connect()` is
	 * pending it aborts that connect (its promise rejects with `ABORTED`) and
	 * never waits for the extension prompt. It resolves once `kheopskit$` has
	 * emitted a state in which this wallet has `isConnected: false`, or once a
	 * later `connect()` or the end of the subscription makes that emission
	 * impossible, and rejects if the platform disconnect fails so callers can
	 * surface or retry. Once the last `kheopskit$` subscriber has unsubscribed,
	 * a call on a wallet object from that subscription rejects with `ABORTED`
	 * without asking the platform and without changing the remembered list. A
	 * `disconnect()` started before that point still settles: the wallet was
	 * forgotten when it was called, and nothing else is written once the
	 * subscription has ended.
	 */
	disconnect: () => Promise<void>;
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
	walletId: WalletId;
};

/**
 * The single WalletConnect connector, shared across every platform.
 *
 * Unlike injected wallets, it is **not tied to a platform**: one WalletConnect
 * session spans whichever namespaces the remote wallet approves in a single
 * pairing (a namespace can't be added to a live session afterwards). So there is
 * exactly one of these in `wallets`, discriminated by `type: "walletconnect"`.
 * Its accounts appear in `accounts`, each carrying its own `platform`.
 */
export type WalletConnectWallet = {
	id: WalletId;
	type: "walletconnect";
	/**
	 * Platforms (namespaces) the live session currently carries. Empty until
	 * connected; populated with whatever the wallet approved (e.g. just
	 * `["ethereum"]`, or `["polkadot", "ethereum"]`).
	 */
	platforms: WalletPlatform[];
	/**
	 * Raw Reown AppKit instance, exposed as an escape hatch for advanced use
	 * (custom modal control, reading providers directly). Most consumers should
	 * use `connect`/`disconnect` and the derived accounts instead.
	 */
	appKit: AppKitInstance;
	name: string;
	icon: string;
	/**
	 * `connecting` while `connect()` opens the modal, `connected` while a
	 * session is live, `disconnected` otherwise. On a reload with a cached
	 * session it is `connecting` until AppKit restores the session or hydration
	 * ends.
	 */
	status: WalletStatus;
	/** The last `connect()` whose modal failed to open. Cleared by the next call. */
	error?: KheopskitError;
	/** `status === "connected"`. */
	isConnected: boolean;
	/**
	 * Opens the WalletConnect modal and resolves once it is open; `isConnected`
	 * follows when the user approves a session. Unlike injected wallets, this
	 * promise does not wait for the state to show the connector connected, and
	 * `signal` is accepted for signature compatibility only.
	 */
	connect: (options?: ConnectOptions) => Promise<void>;
	/** Ends the live session when there is one; resolves at once otherwise. */
	disconnect: () => Promise<void>;
};

/** Narrows a wallet to the platform-less {@link WalletConnectWallet}. */
export const isWalletConnectWallet = (
	wallet: BaseWallet | WalletConnectWallet,
): wallet is WalletConnectWallet => wallet.type === "walletconnect";

/**
 * Narrows a wallet to an injected (browser-extension / Wallet Standard) wallet —
 * the complement of {@link isWalletConnectWallet}. `state.wallets` is
 * `(InjectedWallet | WalletConnectWallet)[]`, so use this to recover the
 * injected-only fields when iterating: `platform`, `sourceId`, and the SDK
 * handle (`provider` on Ethereum, `extension` on Polkadot, `wallet` on Solana).
 *
 * @example
 * ```ts
 * for (const wallet of wallets.filter(isInjectedWallet)) {
 *   console.log(wallet.platform, wallet.sourceId); // typed, no WC widening
 * }
 * ```
 */
export const isInjectedWallet = <W extends BaseWallet | WalletConnectWallet>(
	wallet: W,
): wallet is Exclude<W, WalletConnectWallet> => wallet.type === "injected";

/**
 * Dapp metadata shown in the WalletConnect modal. Mirrors WalletConnect's
 * `Metadata`, declared locally so core doesn't depend on
 * `@walletconnect/universal-provider`.
 */
export type WalletConnectMetadata = {
	name: string;
	description: string;
	url: string;
	icons: string[];
};

export type WalletConnectConfig = {
	projectId: string;
	metadata: WalletConnectMetadata;
	/** Defaults to wss://relay.walletconnect.com */
	relayUrl?: string;
	/**
	 * Networks AppKit should enable. Pass `AppKitNetwork[]` from
	 * `@reown/appkit/networks` (see
	 * https://docs.reown.com/advanced/multichain/polkadot/dapp-integration-guide#walletconnect-code%2Fcomponent-setup).
	 * Loosely typed (`unknown`) so core doesn't depend on `@reown/appkit`'s
	 * types — the value is forwarded to AppKit as-is.
	 */
	networks: [unknown, ...unknown[]];
	themeMode?: "light" | "dark";
	themeVariables?: Record<string, string | number>;
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
	// Receives this platform's (injected) wallets plus the shared, platform-less
	// WalletConnect connector — the plugin derives its injected accounts and, if
	// the WC session carries its namespace, its WalletConnect accounts.
	getAccounts$(
		wallets$: Observable<(TWallet | WalletConnectWallet)[]>,
	): Observable<TAccount[]>;
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
	/**
	 * Which remembered wallets kheopskit reconnects after a reload.
	 *
	 * A wallet is remembered on every successful `connect()` and forgotten on
	 * `disconnect()`, whatever this option says; the list is the store's
	 * `remembered`. `true` reconnects every remembered wallet, `false` none,
	 * and a function is asked for each cached connected wallet on the first
	 * frame, then for each remembered wallet with its live object before the
	 * attempt. The function must be synchronous and pure. It runs on the server
	 * and on the client for the same input and both must agree, or the markup
	 * diverges. It receives the {@link BaseWallet} fields only, so key on `id`.
	 *
	 * A reconnect never prompts while the site stays authorised in the
	 * extension. When the authorisation was revoked the extension prompts once;
	 * a refusal forgets the wallet, so the next load stays silent.
	 *
	 * A wallet this accepts shows `status: "connecting"` from the first frame
	 * until its attempt settles. A wallet this rejects shows `disconnected`
	 * from the first frame, without its cached accounts, so nothing flashes
	 * from connected to disconnected.
	 *
	 * @default true
	 */
	autoReconnect: boolean | ((wallet: BaseWallet) => boolean);
	/**
	 * Platform plugins to enable, e.g. `[polkadot(), solana({ chain })]`.
	 * Import factories from `@kheopskit/core/<platform>`.
	 */
	platforms: P;
	walletConnect?: WalletConnectConfig;
	/**
	 * Dapp name sent to Polkadot injected extensions on connect. Some
	 * extensions (e.g. polkadot.js) warn about a suspicious origin when it's
	 * empty.
	 *
	 * @default walletConnect.metadata.name, then window.location.hostname
	 */
	appName?: string;
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

/**
 * The current kheopskit state.
 *
 * @remarks
 * While {@link KheopskitState.isHydrating} is `true`, `wallets` and `accounts`
 * may contain cached placeholders restored from storage. The **SDK handles** the
 * platform types advertise (e.g. `account.signer` / `getSigner` on Solana,
 * `account.client` on Ethereum, `wallet.provider` / `extension`) are **absent at
 * runtime even though the types claim them**, and placeholder wallets throw if
 * `connect`/`disconnect` is called. Guard all access to those behind
 * `!isHydrating`.
 *
 * The plain, serializable platform data that is persisted in the cache IS
 * restored on the placeholders (Ethereum `chainId`, Polkadot key `type`), so it
 * renders immediately on reload without flashing. Solana `chains` is not cached,
 * so it remains absent until the live account loads.
 */
export type KheopskitState<
	P extends readonly KheopskitPlatform[] = readonly KheopskitPlatform[],
> = {
	wallets: (WalletOf<P[number]> | WalletConnectWallet)[];
	accounts: AccountOf<P[number]>[];
	config: KheopskitConfig<P>;
	/**
	 * Whether the state is still being hydrated from cache.
	 *
	 * During hydration, cached wallets/accounts may be displayed before the
	 * actual wallet extensions have injected. See the type-level remarks: while
	 * this is `true`, SDK-typed fields (signer/client/provider/extension) are not
	 * present at runtime — guard all access behind `!isHydrating`.
	 */
	isHydrating: boolean;
	/**
	 * Whether wallet discovery may still be incomplete.
	 *
	 * `true` when the subscription started before `document.readyState` was
	 * `"complete"`. It turns `false` in the first emission after `window` fired
	 * `load` and the Polkadot registry (`window.injectedWeb3`) was read again,
	 * so that emission already lists every extension injected by `load`. When the
	 * subscription starts after `load`, it is `false` from the first emission.
	 * Always `true` on the server.
	 *
	 * This rests on wallets injecting `injectedWeb3` before `load`. It says
	 * nothing about wallets that inject after `load`. Ethereum (EIP-6963) and
	 * Solana (Wallet Standard) registries are event-driven and need no re-read.
	 */
	isDiscovering: boolean;
};

/** Shape of the persisted store data (localStorage, or cookies in compact form). */
export type KheopskitStoreData = {
	/** Wallets the user connected and has not disconnected */
	remembered?: WalletId[];
	/** Cached wallet state for SSR hydration to prevent UI flash */
	cachedWallets?: CachedWallet[];
	/** Cached account state for SSR hydration to prevent UI flash */
	cachedAccounts?: CachedAccount[];
};

/**
 * The persisted settings store shared between core and framework bindings.
 * Declared structurally here (implemented by `createKheopskitStore`) so modules
 * can depend on the interface without importing the implementation.
 */
export type KheopskitStore = {
	observable: Observable<KheopskitStoreData>;
	rememberWallet: (walletId: WalletId) => void;
	forgetWallet: (walletId: WalletId) => void;
	getCachedState: () => { wallets: CachedWallet[]; accounts: CachedAccount[] };
	setCachedState: (wallets: CachedWallet[], accounts: CachedAccount[]) => void;
	/** Stops cross-tab storage sync and completes `observable`. */
	destroy: () => void;
};

/**
 * Serializable wallet data for SSR hydration cache.
 * Contains only the data needed to render wallet UI without flash.
 * Note: icon is NOT stored to save cookie space - it's looked up at hydration time.
 */
export type CachedWallet = {
	id: WalletId;
	/** Absent for the platform-less WalletConnect connector. */
	platform?: WalletPlatform;
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
