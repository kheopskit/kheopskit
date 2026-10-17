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

type KheopskitSource = {
	store: KheopskitStore;
	kheopskit$: Observable<KheopskitState>;
};

type KheopskitSourceProviderProps = PropsWithChildren<{
	config: Partial<KheopskitConfig> | undefined;
	ssrCookies: string | undefined;
	resolveClientSource: (config: KheopskitConfig) => KheopskitSource;
}>;

const keepPipelineRunning = () => {};

const hydrating = (
	config: KheopskitConfig,
	snapshot: HydratedSnapshot,
): KheopskitState => ({
	...snapshot,
	config,
	isHydrating: true,
	isDiscovering: true,
});

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
					{ icons: false },
				),
	);

export const KheopskitSourceProvider: FC<KheopskitSourceProviderProps> = ({
	children,
	config,
	ssrCookies,
	resolveClientSource,
}) => {
	const resolvedConfig = useMemo(() => resolveConfig(config), [config]);

	const externalStore = useMemo(
		() =>
			createExternalStore(
				() => {
					const { store, kheopskit$ } = resolveClientSource(resolvedConfig);
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
		[resolvedConfig, ssrCookies, resolveClientSource],
	);

	useEffect(
		() => externalStore.subscribe(keepPipelineRunning),
		[externalStore],
	);

	return (
		<KheopskitContext.Provider value={externalStore}>
			{children}
		</KheopskitContext.Provider>
	);
};
