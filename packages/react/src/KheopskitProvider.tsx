import {
	createKheopskitStore,
	getKheopskit$,
	hydrateAccount,
	hydrateWallet,
	type KheopskitConfig,
	type KheopskitState,
	resolveConfig,
} from "@kheopskit/core";
import {
	type FC,
	type PropsWithChildren,
	useEffect,
	useMemo,
	useSyncExternalStore,
} from "react";
import { KheopskitContext } from "./context";
import { createStore } from "./createStore";

export type KheopskitProviderProps = PropsWithChildren & {
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
	const cachedState = useMemo(() => {
		if (ssrCookies === undefined) {
			return { wallets: [], accounts: [] };
		}
		const cached = kheopskitStore.getCachedState();
		return {
			wallets: cached.wallets.map(hydrateWallet),
			accounts: cached.accounts.map(hydrateAccount),
		};
	}, [ssrCookies, kheopskitStore]);

	const defaultValue = useMemo<KheopskitState>(
		() => ({
			wallets: cachedState.wallets,
			accounts: cachedState.accounts,
			config: resolvedConfig,
			isHydrating: true,
		}),
		[resolvedConfig, cachedState],
	);

	const store = useMemo(
		() =>
			createStore(
				getKheopskit$(config, ssrCookies, kheopskitStore),
				defaultValue,
				defaultValue,
			),
		[config, ssrCookies, kheopskitStore, defaultValue],
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
