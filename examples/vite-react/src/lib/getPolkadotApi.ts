import {
	polkadot,
	polkadotAssetHub,
	westendAssetHub,
} from "@polkadot-api/descriptors";

import type { TypedApi } from "polkadot-api";
import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/web";
import { metadataCache } from "./metadataCache";

const DESCRIPTORS = {
	polkadot,
	polkadotAssetHub,
	westendAssetHub,
};

const RPCS = {
	polkadot: "wss://polkadot-asset-hub-rpc.polkadot.io",
	polkadotAssetHub: "wss://polkadot-asset-hub-rpc.polkadot.io",
	westendAssetHub: "wss://asset-hub-westend-rpc.dwellir.com",
};

export type PolkadotChainId = keyof typeof DESCRIPTORS;

type DescriptorsAll = typeof DESCRIPTORS;
export type Descriptors<Id extends PolkadotChainId> = DescriptorsAll[Id];

export type PolkadotApi<ChainId extends PolkadotChainId> = TypedApi<
	Descriptors<ChainId>
>;

const CACHE = new Map<PolkadotChainId, PolkadotApi<PolkadotChainId>>();

export const getPolkadotApi = <ChainId extends PolkadotChainId>(
	chainId: ChainId,
): PolkadotApi<ChainId> => {
	if (!CACHE.has(chainId)) {
		const client = createClient(
			getWsProvider(RPCS[chainId]),
			metadataCache(chainId),
		);
		const descriptors = DESCRIPTORS[chainId] as Descriptors<ChainId>;
		const api = client.getTypedApi(descriptors);
		CACHE.set(chainId, api);
	}

	return CACHE.get(chainId) as PolkadotApi<ChainId>;
};
