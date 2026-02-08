import type { KheopskitConfig } from "@kheopskit/core";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { APPKIT_CHAINS, isEthereumNetwork, isPolkadotNetwork } from "./chains";

type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

export type PlaygroundConfig = Prettify<
	Omit<KheopskitConfig, "walletConnect"> & {
		walletConnect: boolean;
	}
>;

export const demoConfig: PlaygroundConfig = {
	autoReconnect: true,
	platforms: ["polkadot", "ethereum"],
	walletConnect: !!import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID,
	debug: true,
	storageKey: "kheopskit",
	hydrationGracePeriod: 500,
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

export const kheopskitConfig: Partial<KheopskitConfig> =
	getKheopskitConfig(demoConfig);
