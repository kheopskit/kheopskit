import {
	BehaviorSubject,
	distinctUntilChanged,
	from,
	map,
	Observable,
	of,
	shareReplay,
	switchMap,
	tap,
} from "rxjs";
import { clearCachedObservablesByPrefix } from "../utils/getCachedObservable";
import { WALLET_CONNECT_WALLET_ID } from "../utils/WalletId";
import type {
	AppKitInstance,
	KheopskitConfig,
	WalletConnectWallet,
	WalletPlatform,
} from "./types";

/**
 * Dynamically import @reown/appkit/core to avoid loading browser-only code
 * during SSR or in edge runtimes like Cloudflare Workers.
 * The AppKit library uses Lit for web components which requires document.
 */
const loadAppKit = async () => {
	try {
		const { createAppKit } = await import("@reown/appkit/core");
		return createAppKit;
	} catch (cause) {
		console.error(
			"[kheopskit] WalletConnect is configured but @reown/appkit could not be loaded. " +
				"Install it with `pnpm add @reown/appkit` (or remove config.walletConnect). " +
				"WalletConnect wallets are disabled; injected wallets still work.",
			cause,
		);
		return null;
	}
};

const WALLET_CONNECT_ICON =
	"data:image/svg+xml;base64,PHN2ZyBmaWxsPSJub25lIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDQwMCA0MDAiIHdpZHRoPSI0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiPjxjbGlwUGF0aCBpZD0iYSI+PHBhdGggZD0ibTAgMGg0MDB2NDAwaC00MDB6Ii8+PC9jbGlwUGF0aD48ZyBjbGlwLXBhdGg9InVybCgjYSkiPjxjaXJjbGUgY3g9IjIwMCIgY3k9IjIwMCIgZmlsbD0iIzMzOTZmZiIgcj0iMTk5LjUiIHN0cm9rZT0iIzY2YjFmZiIvPjxwYXRoIGQ9Im0xMjIuNTE5IDE0OC45NjVjNDIuNzkxLTQxLjcyOSAxMTIuMTcxLTQxLjcyOSAxNTQuOTYyIDBsNS4xNSA1LjAyMmMyLjE0IDIuMDg2IDIuMTQgNS40NjkgMCA3LjU1NWwtMTcuNjE3IDE3LjE4Yy0xLjA3IDEuMDQzLTIuODA0IDEuMDQzLTMuODc0IDBsLTcuMDg3LTYuOTExYy0yOS44NTMtMjkuMTExLTc4LjI1My0yOS4xMTEtMTA4LjEwNiAwbC03LjU5IDcuNDAxYy0xLjA3IDEuMDQzLTIuODA0IDEuMDQzLTMuODc0IDBsLTE3LjYxNy0xNy4xOGMtMi4xNC0yLjA4Ni0yLjE0LTUuNDY5IDAtNy41NTV6bTE5MS4zOTcgMzUuNTI5IDE1LjY3OSAxNS4yOWMyLjE0IDIuMDg2IDIuMTQgNS40NjkgMCA3LjU1NWwtNzAuNyA2OC45NDRjLTIuMTM5IDIuMDg3LTUuNjA4IDIuMDg3LTcuNzQ4IDBsLTUwLjE3OC00OC45MzFjLS41MzUtLjUyMi0xLjQwMi0uNTIyLTEuOTM3IDBsLTUwLjE3OCA0OC45MzFjLTIuMTM5IDIuMDg3LTUuNjA4IDIuMDg3LTcuNzQ4IDBsLTcwLjcwMTUtNjguOTQ1Yy0yLjEzOTYtMi4wODYtMi4xMzk2LTUuNDY5IDAtNy41NTVsMTUuNjc5NS0xNS4yOWMyLjEzOTYtMi4wODYgNS42MDg1LTIuMDg2IDcuNzQ4MSAwbDUwLjE3ODkgNDguOTMyYy41MzUuNTIyIDEuNDAyLjUyMiAxLjkzNyAwbDUwLjE3Ny00OC45MzJjMi4xMzktMi4wODcgNS42MDgtMi4wODcgNy43NDggMGw1MC4xNzkgNDguOTMyYy41MzUuNTIyIDEuNDAyLjUyMiAxLjkzNyAwbDUwLjE3OS00OC45MzFjMi4xMzktMi4wODcgNS42MDgtMi4wODcgNy43NDggMHoiIGZpbGw9IiNmZmYiLz48L2c+PC9zdmc+";

// Once it exists, the appKit object should never be recreated. Anchored on
// globalThis so it stays a single instance even if this module is duplicated
// across bundle chunks (e.g. CJS subpath entries).
const APPKIT_SYMBOL = Symbol.for("kheopskit.cachedAppKit");
type AppKitGlobal = Record<
	symbol,
	Observable<WalletConnectWallet | null> | undefined
>;
const getCachedAppKit = ():
	| Observable<WalletConnectWallet | null>
	| undefined => (globalThis as unknown as AppKitGlobal)[APPKIT_SYMBOL];
const setCachedAppKit = (
	value: Observable<WalletConnectWallet | null> | undefined,
): void => {
	(globalThis as unknown as AppKitGlobal)[APPKIT_SYMBOL] = value;
};

/**
 * Clears the cached AppKit observable.
 * Use when configuration changes or for testing purposes.
 * Note: This does NOT destroy the appKit instance created by Reown.
 */
export const resetAppKitCache = (): void => {
	setCachedAppKit(undefined);
};

/**
 * Drops a WalletConnect namespace's cached account observables. Called when a
 * namespace transitions to disconnected — including external disconnects (from
 * the wallet app), which flip status via `subscribeProviders` without ever
 * calling `disconnect()` — so a later reconnect rebuilds the account observables
 * against the fresh session instead of a stale closure.
 *
 * Keys are `accounts:<walletId>:...`; the trailing colon scopes the prefix to
 * this wallet and avoids matching a sibling whose id is a string prefix.
 */
const dropAccountsCache = (platform: WalletPlatform): void => {
	clearCachedObservablesByPrefix(
		`accounts:${WALLET_CONNECT_WALLET_ID}:${platform}:`,
	);
};

/**
 * The single, platform-less WalletConnect connector for the given config — or
 * `null` when WalletConnect isn't configured, on the server, or when
 * `@reown/appkit` isn't installed.
 *
 * @remarks
 * The AppKit instance is a process-wide singleton (Reown AppKit itself cannot
 * be instantiated twice). The **first** call with a `walletConnect` config wins;
 * later calls with a *different* `walletConnect` config reuse that first
 * instance. Call {@link resetAppKitCache} before re-initialising if the
 * WalletConnect config must change.
 *
 * One WalletConnect session is shared across every namespace, and a namespace
 * can only be established during the initial pairing — it can't be added to a
 * live session afterwards. So this exposes ONE connector (not one per platform):
 * `connect()` opens the modal; the wallet approves whichever namespaces it
 * supports in that single pairing, and `platforms` reflects what the live
 * session carries. Per-namespace accounts are derived by each platform plugin.
 */
export const getWalletConnectWallet$ = (
	config: KheopskitConfig,
): Observable<WalletConnectWallet | null> => {
	if (!config.walletConnect) return of(null);

	// SSR guard - don't try to load AppKit on the server
	if (typeof window === "undefined") return of(null);

	const walletConnect = config.walletConnect;

	let cachedAppKit = getCachedAppKit();
	if (!cachedAppKit) {
		// Dynamic import avoids loading @reown/appkit at module-eval time (SSR /
		// edge runtimes like Cloudflare Workers).
		cachedAppKit = from(loadAppKit()).pipe(
			switchMap((createAppKit) => {
				// @reown/appkit missing (optional peer dep) — degrade gracefully.
				if (!createAppKit) return of<WalletConnectWallet | null>(null);
				return new Observable<WalletConnectWallet | null>((subscriber) => {
					const appKit = createAppKit({
						projectId: walletConnect.projectId,
						metadata: walletConnect.metadata,
						// Loosely typed in WalletConnectConfig to keep @reown/appkit's
						// types out of core; forwarded to AppKit verbatim.
						networks: walletConnect.networks as never,
						themeMode: walletConnect.themeMode,
						themeVariables: walletConnect.themeVariables as never,
						universalProviderConfigOverride: {
							methods: {
								polkadot: ["polkadot_signTransaction", "polkadot_signMessage"],
								solana: [
									"solana_signTransaction",
									"solana_signMessage",
									"solana_signAndSendTransaction",
								],
							},
						},
						allWallets: "HIDE",
						debug: config.debug,
						allowUnsupportedChain: true,
					});

					// Exposed on the wallet as the (decoupled) AppKitInstance escape hatch.
					const appKitInstance = appKit as unknown as AppKitInstance;

					const status$ = new BehaviorSubject({
						isPolkadotConnected: false,
						isEthereumConnected: false,
						isSolanaConnected: false,
					});

					const unsubProviders = appKit.subscribeProviders((providers) => {
						status$.next({
							isPolkadotConnected: !!providers.polkadot,
							isEthereumConnected: !!providers.eip155,
							isSolanaConnected: !!providers.solana,
						});
					});

					const namespaceOf: Record<WalletPlatform, string> = {
						polkadot: "polkadot",
						ethereum: "eip155",
						solana: "solana",
					};
					const allPlatforms: WalletPlatform[] = [
						"polkadot",
						"ethereum",
						"solana",
					];
					const enabledPlatforms = allPlatforms.filter((p) =>
						(appKit.chainNamespaces as string[]).includes(namespaceOf[p]),
					);

					let prevConnected = {
						polkadot: false,
						ethereum: false,
						solana: false,
					};

					const sub = status$
						.pipe(
							map((s) => ({
								polkadot: s.isPolkadotConnected,
								ethereum: s.isEthereumConnected,
								solana: s.isSolanaConnected,
							})),
							distinctUntilChanged(
								(a, b) =>
									a.polkadot === b.polkadot &&
									a.ethereum === b.ethereum &&
									a.solana === b.solana,
							),
							tap((connected) => {
								// Drop caches for namespaces that just went disconnected.
								for (const platform of allPlatforms)
									if (prevConnected[platform] && !connected[platform])
										dropAccountsCache(platform);
								prevConnected = connected;
							}),
							map((connected): WalletConnectWallet => {
								const platforms = enabledPlatforms.filter((p) => connected[p]);
								const isConnected = platforms.length > 0;
								const walletInfo = appKit.getWalletInfo();
								return {
									id: WALLET_CONNECT_WALLET_ID,
									type: "walletconnect",
									platforms,
									appKit: appKitInstance,
									name: walletInfo?.name ?? "WalletConnect",
									icon: walletInfo?.icon ?? WALLET_CONNECT_ICON,
									// One shared session: connecting opens the modal; the wallet
									// approves namespaces in that single pairing. Disconnect is
									// session-wide; re-pair to change the approved set.
									connect: async () => {
										if (!isConnected) await appKit.open();
									},
									disconnect: async () => {
										if (isConnected) await appKit.disconnect();
									},
									isConnected,
								};
							}),
						)
						.subscribe(subscriber);

					return () => {
						sub.unsubscribe();
						unsubProviders();
					};
				});
			}),
			shareReplay({ refCount: true, bufferSize: 1 }),
		);
		setCachedAppKit(cachedAppKit);
	}

	return cachedAppKit;
};
