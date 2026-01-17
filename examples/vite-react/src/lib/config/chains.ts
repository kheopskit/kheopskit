import type { CaipNetwork } from "@reown/appkit/core";
import { type AppKitNetwork, defineChain } from "@reown/appkit/networks";
import * as viemChains from "viem/chains";
import type { PolkadotChainId } from "../getPolkadotApi";

export const polkadot = defineChain({
	id: "91b171bb158e2d3848fa23a9f1c25182",
	name: "Polkadot",
	nativeCurrency: { name: "Polkadot", symbol: "DOT", decimals: 10 },
	rpcUrls: {
		default: {
			http: ["https://rpc.ibp.network/polkadot"],
			webSocket: ["wss://rpc.ibp.network/polkadot"],
		},
	},
	blockExplorers: {
		default: {
			name: "Polkadot Explorer",
			url: "https://polkadot.subscan.io/",
		},
	},
	chainNamespace: "polkadot",
	caipNetworkId: "polkadot:91b171bb158e2d3848fa23a9f1c25182",
});

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

export const westendAssetHub = defineChain({
	id: "67f9723393ef76214df0118c34bbbd3d",
	name: "Westend Asset Hub",
	nativeCurrency: { name: "Westend", symbol: "WND", decimals: 10 },
	rpcUrls: {
		default: {
			http: ["https://westend-asset-hub.polkadot.io"],
			webSocket: ["wss://westend-asset-hub.polkadot.io"],
		},
	},
	blockExplorers: {
		default: {
			name: "Polkadot Explorer",
			url: "https://assethub-westend.subscan.io/",
		},
	},
	chainNamespace: "polkadot",
	caipNetworkId: "polkadot:67f9723393ef76214df0118c34bbbd3d",
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
	polkadot,
	polkadotAssetHub,
	westendAssetHub,
	viemChainToWalletConnectChain(viemChains.sepolia),
	viemChainToWalletConnectChain(viemChains.moonbaseAlpha),
	viemChainToWalletConnectChain(viemChains.mainnet),
	viemChainToWalletConnectChain(viemChains.westendAssetHub),
];

export const VIEM_CHAINS_BY_ID: Record<number, viemChains.Chain> =
	Object.fromEntries(Object.values(viemChains).map((c) => [c.id, c]));

// maps a chain id to a papi descriptor key
export const APPKIT_CHAIN_ID_TO_DOT_CHAIN_ID: Record<string, PolkadotChainId> =
	{
		"91b171bb158e2d3848fa23a9f1c25182": "polkadot",
		"68d56f15f85d3136970ec16946040bc1": "polkadotAssetHub",
		"67f9723393ef76214df0118c34bbbd3d": "westendAssetHub",
	};

export const isPolkadotNetwork = (network: AppKitNetwork): boolean => {
	const n = network as CaipNetwork;
	return n.chainNamespace === "polkadot";
};

export const isEthereumNetwork = (network: AppKitNetwork): boolean => {
	const n = network as CaipNetwork;
	return n.chainNamespace === "eip155";
};
