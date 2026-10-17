import {
	createKheopskitStore,
	getHydratedSnapshot,
	type HydratedSnapshot,
	type KheopskitConfig,
	type KheopskitState,
	type KheopskitStore,
	resolveConfig,
} from "@kheopskit/core";
import {
	type FC,
	type PropsWithChildren,
	useEffect,
	useLayoutEffect,
	useMemo,
} from "react";
import { KheopskitContext } from "./context";
import { createExternalStore } from "./createExternalStore";
import { withLiveActions } from "./liveActions";
import type { LivePipeline } from "./livePipeline";

type KheopskitSource = {
	store: KheopskitStore;
	pipeline: LivePipeline<KheopskitState>;
};

type KheopskitSourceProviderProps = PropsWithChildren<{
	config: Partial<KheopskitConfig> | undefined;
	ssrCookies: string | undefined;
	resolveClientSource: (config: KheopskitConfig) => KheopskitSource;
}>;

const keepPipelineRunning = () => {};

// A layout effect, so that a child's layout effect calling an action on reveal
// finds the pipeline held again one microtask later (see createExternalStore).
const useIsomorphicLayoutEffect =
	typeof window === "undefined" ? useEffect : useLayoutEffect;

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
			withLiveActions(
				createExternalStore(
					() => {
						const { store, pipeline } = resolveClientSource(resolvedConfig);
						return {
							pipeline,
							initialValue: hydrating(
								resolvedConfig,
								getHydratedSnapshot(store, resolvedConfig, { icons: true }),
							),
						};
					},
					serverSnapshot(resolvedConfig, ssrCookies),
				),
			),
		[resolvedConfig, ssrCookies, resolveClientSource],
	);

	useIsomorphicLayoutEffect(
		() => externalStore.subscribe(keepPipelineRunning),
		[externalStore],
	);

	return (
		<KheopskitContext.Provider value={externalStore}>
			{children}
		</KheopskitContext.Provider>
	);
};
