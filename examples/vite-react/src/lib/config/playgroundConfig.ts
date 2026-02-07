import type { KheopskitConfig } from "@kheopskit/core";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { APPKIT_CHAINS, isEthereumNetwork, isPolkadotNetwork } from "./chains";
import { createStore } from "./createStore";

type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

export type PlaygroundConfig = Prettify<
	Omit<KheopskitConfig, "walletConnect"> & {
		walletConnect: boolean;
	}
>;

const demoConfigStore = createStore<PlaygroundConfig>("playground.config", {
	autoReconnect: true,
	platforms: ["polkadot", "ethereum"],
	walletConnect: !!import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID,
	debug: true,
	storageKey: "kheopskit",
});

export const usePlaygroundConfig = () => {
	const demoConfig = useSyncExternalStore(
		demoConfigStore.subscribe,
		demoConfigStore.getSnapshot,
	);

	const setAutoReconnect = useCallback((enabled: boolean) => {
		demoConfigStore.mutate((prev) => ({
			...prev,
			autoReconnect: enabled,
		}));
	}, []);

	const setPlatformEnabled = useCallback(
		(platform: KheopskitConfig["platforms"][number], enabled: boolean) => {
			demoConfigStore.mutate((prev) => {
				const prevPlatforms = prev?.platforms ?? [];
				const platforms = enabled
					? prevPlatforms.includes(platform)
						? prevPlatforms
						: prevPlatforms.concat(platform)
					: prevPlatforms.filter((p) => p !== platform);

				return {
					...prev,
					platforms,
				};
			});
		},
		[],
	);

	const setWalletConnect = useCallback((enabled: boolean) => {
		demoConfigStore.mutate((prev) => {
			return {
				...prev,
				walletConnect: enabled,
			};
		});
	}, []);

	const kheopskitConfig = useMemo(
		() => getKheopskitConfig(demoConfig),
		[demoConfig],
	);

	return {
		demoConfig,
		kheopskitConfig,
		setAutoReconnect,
		setPlatformEnabled,
		setWalletConnect,
	};
};

const getKheopskitConfig = (
	config: PlaygroundConfig,
): Partial<KheopskitConfig> => {
	const platforms = config.platforms ?? [];
	const networks = getNetworks(platforms);

	return {
		...config,
		walletConnect:
			config.walletConnect && networks
				? {
						projectId: import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID,
						metadata: {
							name: "Kheopskit Demo",
							description: "Kheopskit Demo",
							url: window.location.origin,
							icons: [],
						},
						networks,
					}
				: undefined,
	};
};

const getNetworks = (platforms: KheopskitConfig["platforms"]) => {
	const networks: AppKitNetwork[] = [
		...(platforms.includes("polkadot")
			? APPKIT_CHAINS.filter(isPolkadotNetwork)
			: []),
		...(platforms.includes("ethereum")
			? APPKIT_CHAINS.filter(isEthereumNetwork)
			: []),
	];

	return networks.length
		? (networks as [AppKitNetwork, ...AppKitNetwork[]])
		: null;
};
