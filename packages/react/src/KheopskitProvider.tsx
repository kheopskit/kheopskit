import {
	getKheopskit$,
	type KheopskitConfig,
	type KheopskitState,
	resolveConfig,
} from "@kheopskit/core";
import {
	type FC,
	type PropsWithChildren,
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
	 */
	ssrCookies?: string;
};

export const KheopskitProvider: FC<KheopskitProviderProps> = ({
	children,
	config,
	ssrCookies,
}) => {
	const defaultValue = useMemo<KheopskitState>(
		() => ({
			wallets: [],
			accounts: [],
			config: resolveConfig(config),
		}),
		[config],
	);

	const store = useMemo(
		() => createStore(getKheopskit$(config, ssrCookies), defaultValue),
		[config, ssrCookies, defaultValue],
	);

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
