import type { KheopskitConfig } from "./types";

/**
 * Default storage key for persisting wallet connection state.
 * Can be overridden via config.storageKey to avoid conflicts
 * when running multiple dapps on the same domain.
 */
export const DEFAULT_STORAGE_KEY = "kheopskit";

const DEFAULT_CONFIG: KheopskitConfig = {
	autoReconnect: true,
	platforms: ["polkadot"],
	debug: false,
	storageKey: DEFAULT_STORAGE_KEY,
};

export const resolveConfig = (
	config: Partial<KheopskitConfig> | undefined,
): KheopskitConfig => {
	return Object.assign({}, DEFAULT_CONFIG, config);
};
