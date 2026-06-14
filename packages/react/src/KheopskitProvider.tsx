import {
	createKheopskitStore,
	getKheopskit$,
	type KheopskitConfig,
	type KheopskitState,
	resolveConfig,
} from "@kheopskit/core";
import {
	acceptsCachedAccount,
	getCachedIcon,
	hydrateAccount,
	hydrateWallet,
	sortAccounts,
	sortWallets,
} from "@kheopskit/core/internal";
import {
	type FC,
	type PropsWithChildren,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import { KheopskitContext } from "./context";
import { createStore } from "./createStore";

export type KheopskitProviderProps = PropsWithChildren & {
	/**
	 * Kheopskit configuration.
	 *
	 * @remarks
	 * Must be a **referentially stable** value — define it once (module scope, a
	 * `useMemo`, or via {@link createKheopskit}) and pass the same reference. A
	 * new object literal on every render (`config={{ platforms: [...] }}` inline)
	 * recreates the underlying store and re-subscribes each render.
	 */
	config?: Partial<KheopskitConfig>;
	/**
	 * Cookie string for SSR hydration.
	 * Pass the request cookie header (e.g., from Next.js headers or TanStack Start)
	 * to hydrate wallet state on the server.
	 *
	 * @remarks
	 * This value should be stable per render to avoid unnecessary store recreation.
	 * Compute it once in your server component or layout and pass it down.
	 *
	 * @example
	 * ```tsx
	 * // Next.js App Router
	 * const cookieStore = await cookies();
	 * const ssrCookies = cookieStore.getAll().map(c => `${c.name}=${c.value}`).join('; ');
	 * return <Providers ssrCookies={ssrCookies}>{children}</Providers>
	 * ```
	 */
	ssrCookies?: string;
};

export const KheopskitProvider: FC<KheopskitProviderProps> = ({
	children,
	config,
	ssrCookies,
}) => {
	const resolvedConfig = useMemo(() => resolveConfig(config), [config]);

	// Dev-only: warn if the `config` prop reference changes between renders. A new
	// object each render recreates the store and re-subscribes the whole pipeline
	// (re-hydrating, dropping live connection state) on every render. `config` must
	// be referentially stable — define it at module scope, memoize it, or use
	// createKheopskit() (which passes a stable reference for you).
	const lastConfigRef = useRef(config);
	const hasMountedRef = useRef(false);
	useEffect(() => {
		if (
			hasMountedRef.current &&
			lastConfigRef.current !== config &&
			(typeof process === "undefined" || process.env?.NODE_ENV !== "production")
		) {
			console.warn(
				"[kheopskit] KheopskitProvider received a new `config` reference; this " +
					"recreates the store and re-subscribes on every render. Pass a " +
					"referentially stable config (module scope, useMemo, or createKheopskit()).",
			);
		}
		hasMountedRef.current = true;
		lastConfigRef.current = config;
	}, [config]);

	// Create a single store for both reading cached state and powering the observable
	const kheopskitStore = useMemo(
		() =>
			createKheopskitStore({
				ssrCookies,
				storageKey: resolvedConfig.storageKey,
			}),
		[ssrCookies, resolvedConfig.storageKey],
	);

	// Read cached state from the store for SSR hydration
	// This produces wallets WITHOUT localStorage icons (Ethereum wallets have no icon)
	// because localStorage isn't available on server
	const serverValue = useMemo<KheopskitState>(() => {
		if (ssrCookies === undefined) {
			return {
				wallets: [],
				accounts: [],
				config: resolvedConfig,
				isHydrating: true,
			};
		}
		const cached = kheopskitStore.getCachedState();
		return {
			wallets: cached.wallets.map(hydrateWallet).sort(sortWallets),
			accounts: cached.accounts
				.filter((account) =>
					acceptsCachedAccount(account, resolvedConfig.platforms),
				)
				.map(hydrateAccount)
				.sort(sortAccounts),
			config: resolvedConfig,
			isHydrating: true,
		};
	}, [ssrCookies, kheopskitStore, resolvedConfig]);

	// Client-only initial snapshot, read straight from the client cache so a hard
	// reload paints the cached wallet/account list on the very first frame instead
	// of flashing empty until the live observable produces its first emission —
	// which can be asynchronous (e.g. WalletConnect's AppKit is loaded via dynamic
	// import, so the underlying combineLatest can't emit synchronously).
	//
	// We can't derive this from `serverValue`: without SSR cookies that stays empty
	// (to keep the server/client hydration markup identical), so the SPA case would
	// otherwise render nothing. This snapshot is only ever read on the client via
	// getSnapshot, so reading the cache here is safe — and getCachedIcon returns ""
	// on the server, making the icon enrichment a no-op there.
	const initialValue = useMemo<KheopskitState>(() => {
		const cached = kheopskitStore.getCachedState();
		return {
			wallets: cached.wallets
				.map(hydrateWallet)
				.map((wallet) => {
					if (wallet.icon) return wallet;
					const cachedIcon = getCachedIcon(wallet.id);
					return cachedIcon ? { ...wallet, icon: cachedIcon } : wallet;
				})
				.sort(sortWallets),
			accounts: cached.accounts
				.filter((account) =>
					acceptsCachedAccount(account, resolvedConfig.platforms),
				)
				.map(hydrateAccount)
				.sort(sortAccounts),
			config: resolvedConfig,
			isHydrating: true,
		};
	}, [kheopskitStore, resolvedConfig]);

	const store = useMemo(
		() =>
			createStore(
				getKheopskit$(config, { ssrCookies, store: kheopskitStore }),
				initialValue,
				serverValue,
			),
		[config, ssrCookies, kheopskitStore, initialValue, serverValue],
	);

	// Cleanup store subscriptions when store changes or component unmounts
	useEffect(() => {
		return () => store.destroy();
	}, [store]);

	const state = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getServerSnapshot,
	);

	const value = useMemo(() => ({ state }), [state]);

	return (
		<KheopskitContext.Provider value={value}>
			{children}
		</KheopskitContext.Provider>
	);
};
