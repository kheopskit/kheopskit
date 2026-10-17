import {
	createKheopskitStore,
	getHydratedSnapshot,
	type HydratedSnapshot,
	type KheopskitConfig,
	type KheopskitState,
	type KheopskitStore,
	resolveConfig,
} from "@kheopskit/core";
import { type FC, type PropsWithChildren, useEffect, useMemo } from "react";
import type { Observable } from "rxjs";
import { KheopskitContext } from "./context";
import { createExternalStore } from "./createExternalStore";

export type KheopskitSource = {
	store: KheopskitStore;
	kheopskit$: Observable<KheopskitState>;
};

type KheopskitSourceProviderProps = PropsWithChildren<{
	config: Partial<KheopskitConfig> | undefined;
	ssrCookies: string | undefined;
	resolveSource: (config: KheopskitConfig) => KheopskitSource;
}>;

const hydrating = (
	config: KheopskitConfig,
	snapshot: HydratedSnapshot,
): KheopskitState => ({
	...snapshot,
	config,
	isHydrating: true,
	isDiscovering: true,
});

// Icons stay off: this snapshot must match the server-rendered markup, and the
// server never sees the localStorage icon cache.
const serverSnapshot = (
	config: KheopskitConfig,
	ssrCookies: string | undefined,
): KheopskitState =>
	hydrating(
		config,
		ssrCookies === undefined
			? { wallets: [], accounts: [] }
			: getHydratedSnapshot(
					createKheopskitStore({ ssrCookies, storageKey: config.storageKey }),
					config,
				),
	);

export const KheopskitSourceProvider: FC<KheopskitSourceProviderProps> = ({
	children,
	config,
	ssrCookies,
	resolveSource,
}) => {
	const resolvedConfig = useMemo(() => resolveConfig(config), [config]);

	const externalStore = useMemo(
		() =>
			createExternalStore(
				() => {
					const { store, kheopskit$ } = resolveSource(resolvedConfig);
					return {
						observable$: kheopskit$,
						initialValue: hydrating(
							resolvedConfig,
							getHydratedSnapshot(store, resolvedConfig, { icons: true }),
						),
					};
				},
				serverSnapshot(resolvedConfig, ssrCookies),
			),
		[resolvedConfig, ssrCookies, resolveSource],
	);

	// Discovery and auto-reconnect run while the provider is mounted, even when
	// no component reads the state.
	useEffect(() => externalStore.subscribe(() => {}), [externalStore]);

	return (
		<KheopskitContext.Provider value={externalStore}>
			{children}
		</KheopskitContext.Provider>
	);
};
