import { getMetadata as getDescriptorsMetadata } from "@polkadot-api/descriptors";
import { base64 } from "@scure/base";

const STORAGE_KEY = "metadataCache";
const DEFAULT_MAX_CACHE_DURATION = 1000 * 60 * 60 * 24 * 7; // 7 days

type MetadataCacheStorage = {
	[code: string]: {
		metadata: string;
		timestamp: number; // read/write timestamp, helps identify unused cache entries
		chainId: string;
	};
};

/**
 * Will always keep the latest provided metadata for each chainId
 * and remove the rest if they are older than MAX_CACHE_DURATION
 * @param chainId
 * @returns
 */
export const metadataCache = (
	chainId: string,
	maxDuration = DEFAULT_MAX_CACHE_DURATION,
) => {
	const readCache = (): MetadataCacheStorage => {
		if (typeof window === "undefined") return {};
		const serialized = window.localStorage.getItem(STORAGE_KEY);
		try {
			return serialized ? JSON.parse(serialized) : {};
		} catch (err) {
			console.error("[metadata cache] Failed to parse metadata cache", err);
			return {};
		}
	};

	const writeCache = (cache: MetadataCacheStorage) => {
		if (typeof window === "undefined") return;
		const mostRecentByChain = Object.values(cache).reduce(
			(acc, { chainId, timestamp }) => {
				const mostRecent = acc[chainId] ?? 0;
				acc[chainId] = timestamp > mostRecent ? timestamp : mostRecent;
				return acc;
			},
			{} as Record<string, number>,
		);

		// cleanup cache: for each chain keep the most recent and delete others if too old
		for (const [key, value] of Object.entries(cache))
			if (value.timestamp < mostRecentByChain[value.chainId])
				if (value.timestamp < Date.now() - maxDuration) delete cache[key];

		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
	};

	const setMetadata = (key: string, value: Uint8Array) => {
		console.time("[metadata cache] setMetadata");
		try {
			const cache = readCache();
			cache[key] = {
				metadata: base64.encode(value),
				timestamp: Date.now(),
				chainId,
			};

			writeCache(cache);
		} catch (err) {
			console.error("[metadata cache] Failed to set metadata", err);
		}
	};

	const getMetadata = async (key: string) => {
		try {
			const cache = readCache();
			if (cache[key]) {
				const metadata = base64.decode(cache[key].metadata);
				cache[key].timestamp = Date.now();
				writeCache(cache);
				return metadata;
			}

			const metadata = await getDescriptorsMetadata(key);
			if (metadata) setMetadata(key, metadata);
			return metadata;
		} catch (err) {
			console.error("[metadata cache] Failed to get metadata", err);
			return null;
		}
	};

	return {
		getMetadata,
		setMetadata,
	};
};
