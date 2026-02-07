import {
	getKheopskit$,
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

	// Warn if SSR is detected but ssrCookies is not provided
	useEffect(() => {
		if (!resolvedConfig.debug) return;

		// Check if we're in an SSR-capable environment (React 18+ with hydrateRoot)
		// by detecting if localStorage has data that wasn't available during SSR
		if (ssrCookies === undefined && typeof window !== "undefined") {
			const storageKey = resolvedConfig.storageKey;
			const storedData = localStorage.getItem(storageKey);

			if (storedData && storedData !== "{}") {
				console.warn(
					`[kheopskit] Persisted wallet data found in localStorage but no \`ssrCookies\` prop provided.\n` +
						`This may cause hydration mismatches in SSR frameworks (Next.js, TanStack Start, etc.).\n` +
						`To fix: Pass the request cookies to KheopskitProvider:\n\n` +
						`  <KheopskitProvider ssrCookies={cookies} config={config}>\n\n` +
						`See: https://github.com/kheopskit/kheopskit#server-side-rendering-ssr`,
				);
			}
		}
	}, [ssrCookies, resolvedConfig.debug, resolvedConfig.storageKey]);

	const defaultValue = useMemo<KheopskitState>(
		() => ({
			wallets: [],
			accounts: [],
			config: resolvedConfig,
		}),
		[resolvedConfig],
	);

	const store = useMemo(
		() => createStore(getKheopskit$(config, ssrCookies), defaultValue),
		[config, ssrCookies, defaultValue],
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
