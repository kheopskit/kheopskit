import { type EthereumAccount, ethereum } from "@kheopskit/core/ethereum";
import { type PolkadotAccount, polkadot } from "@kheopskit/core/polkadot";
import { type SolanaAccount, solana } from "@kheopskit/core/solana";
import { type CreateKheopskitConfig, createKheopskit } from "@kheopskit/react";
import type { AppKitNetwork } from "@reown/appkit/networks";
import {
	APPKIT_CHAINS,
	isEthereumNetwork,
	isPolkadotNetwork,
	isSolanaNetwork,
} from "./chains";

/**
 * Platform plugins enabled in the playground. The tuple type flows through
 * `useWallets<Platforms>()` so account/wallet types stay SDK-precise.
 */
export const platforms = [
	polkadot({ accountTypes: ["sr25519", "ed25519", "ecdsa", "ethereum"] }),
	ethereum(),
	solana({ chain: "solana:mainnet" }),
] as const;

export type Platforms = typeof platforms;
export type WalletAccount = PolkadotAccount | EthereumAccount | SolanaAccount;

const enabledPlatforms = platforms.map((p) => p.platform);

const getNetworks = () => {
	const networks: AppKitNetwork[] = [
		...(enabledPlatforms.includes("polkadot")
			? APPKIT_CHAINS.filter(isPolkadotNetwork)
			: []),
		...(enabledPlatforms.includes("ethereum")
			? APPKIT_CHAINS.filter(isEthereumNetwork)
			: []),
		...(enabledPlatforms.includes("solana")
			? APPKIT_CHAINS.filter(isSolanaNetwork)
			: []),
	];

	return networks.length
		? (networks as [AppKitNetwork, ...AppKitNetwork[]])
		: null;
};

const networks = getNetworks();

export const kheopskitConfig = {
	autoReconnect: true,
	platforms,
	debug: true,
	storageKey: "kheopskit",
	hydrationGracePeriod: 500,
	walletConnect:
		import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID && networks
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
} satisfies CreateKheopskitConfig<Platforms>;

export const { KheopskitProvider, useWallets, useAccounts } =
	createKheopskit(kheopskitConfig);
