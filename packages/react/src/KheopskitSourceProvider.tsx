import {
	createKheopskitStore,
	getHydratedSnapshot,
	type HydratedSnapshot,
	type Kheopskit,
	type KheopskitConfig,
	type KheopskitPlatform,
	type KheopskitState,
	resolveConfig,
} from "@kheopskit/core";
import { kheopskitInternals } from "@kheopskit/core/internal";
import {
	type FC,
	type PropsWithChildren,
	useEffect,
	useLayoutEffect,
	useMemo,
} from "react";
import { KheopskitContext, type KheopskitExternalStore } from "./context";
import { createExternalStore } from "./createExternalStore";

type KheopskitSourceProviderProps = PropsWithChildren<{
	kit: Kheopskit<readonly KheopskitPlatform[]>;
	config: Partial<KheopskitConfig> | undefined;
	ssrCookies: string | undefined;
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
	kit,
	config,
	ssrCookies,
}) => {
	const resolvedConfig = useMemo(() => resolveConfig(config), [config]);

	const externalStore = useMemo((): KheopskitExternalStore => {
		const { present, walletActions } = kheopskitInternals(kit);
		return {
			...createExternalStore(
				kit.kheopskit$,
				() =>
					present(
						hydrating(
							resolvedConfig,
							getHydratedSnapshot(kit.store, resolvedConfig, { icons: true }),
						),
					),
				present(serverSnapshot(resolvedConfig, ssrCookies)),
			),
			walletActions,
		};
	}, [kit, resolvedConfig, ssrCookies]);

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
