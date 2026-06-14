import type { CaipNetwork } from "@reown/appkit/core";
import {
	type AppKitNetwork,
	defineChain,
	solana,
} from "@reown/appkit/networks";
import * as viemChains from "viem/chains";
import type { PolkadotChainId } from "../getPolkadotApi";

export const polkadotAssetHub = defineChain({
	id: "68d56f15f85d3136970ec16946040bc1",
	name: "Polkadot Asset Hub",
	nativeCurrency: { name: "Polkadot", symbol: "DOT", decimals: 10 },
	rpcUrls: {
		default: {
			http: ["https://polkadot-asset-hub-rpc.polkadot.io"],
			webSocket: ["wss://polkadot-asset-hub-rpc.polkadot.io"],
		},
	},
	blockExplorers: {
		default: {
			name: "Polkadot Explorer",
			url: "https://assethub-polkadot.subscan.io/",
		},
	},
	chainNamespace: "polkadot",
	caipNetworkId: "polkadot:68d56f15f85d3136970ec16946040bc1",
});

// Polkadot Asset Hub's EVM (PolkaVM) endpoint, exposed as an eip155 network so
// it shows up under the Ethereum platform. Distinct from `polkadotAssetHub`
// above, which is the substrate (polkadot-namespace) view of the same chain.
export const polkadotAssetHubEvm = defineChain({
	id: "420420419",
	name: "Polkadot Asset Hub (EVM)",
	nativeCurrency: { name: "DOT", symbol: "DOT", decimals: 18 },
	rpcUrls: {
		default: {
			http: [
				"https://services.polkadothub-rpc.com/mainnet",
				"https://eth-rpc.polkadot.io",
			],
		},
	},
	blockExplorers: {
		default: {
			name: "Blockscout",
			url: "https://blockscout.polkadot.io/",
		},
	},
	chainNamespace: "eip155",
	caipNetworkId: "eip155:420420419",
});

const viemChainToWalletConnectChain = (chain: viemChains.Chain) => {
	// Don't use structuredClone - viem chains may contain functions that can't be cloned
	return defineChain({
		id: chain.id.toString(),
		name: chain.name,
		nativeCurrency: chain.nativeCurrency,
		rpcUrls: chain.rpcUrls,
		blockExplorers: chain.blockExplorers,
		contracts: chain.contracts,
		chainNamespace: "eip155",
		caipNetworkId: `eip155:${chain.id}`,
	});
};

export const APPKIT_CHAINS: [AppKitNetwork, ...AppKitNetwork[]] = [
	polkadotAssetHub,
	polkadotAssetHubEvm,
	viemChainToWalletConnectChain(viemChains.mainnet),
	viemChainToWalletConnectChain(viemChains.base),
	solana,
];

export const VIEM_CHAINS_BY_ID: Record<number, viemChains.Chain> =
	Object.fromEntries(Object.values(viemChains).map((c) => [c.id, c]));

// maps a chain id to a papi descriptor key
export const APPKIT_CHAIN_ID_TO_DOT_CHAIN_ID: Record<string, PolkadotChainId> =
	{
		"68d56f15f85d3136970ec16946040bc1": "polkadotAssetHub",
	};

export const isPolkadotNetwork = (network: AppKitNetwork): boolean => {
	const n = network as CaipNetwork;
	return n.chainNamespace === "polkadot";
};

export const isEthereumNetwork = (network: AppKitNetwork): boolean => {
	const n = network as CaipNetwork;
	return n.chainNamespace === "eip155";
};

export const isSolanaNetwork = (network: AppKitNetwork): boolean => {
	const n = network as CaipNetwork;
	return n.chainNamespace === "solana";
};
