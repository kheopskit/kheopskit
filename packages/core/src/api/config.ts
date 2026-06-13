import type { KheopskitConfig, KheopskitPlatform } from "./types";

/**
 * Default storage key for persisting wallet connection state.
 * Can be overridden via config.storageKey to avoid conflicts
 * when running multiple dapps on the same domain.
 */
export const DEFAULT_STORAGE_KEY = "kheopskit";

const DEFAULTS = {
	autoReconnect: true,
	debug: false,
	storageKey: DEFAULT_STORAGE_KEY,
	hydrationGracePeriod: 500,
} satisfies Omit<KheopskitConfig, "platforms" | "walletConnect">;

export const resolveConfig = <
	const P extends readonly KheopskitPlatform[] = readonly KheopskitPlatform[],
>(
	config?: Partial<KheopskitConfig<P>>,
): KheopskitConfig<P> => {
	const platforms = (config?.platforms ?? []) as P;

	if (platforms.length === 0) {
		console.warn(
			"[kheopskit] No platforms configured; wallets and accounts will be empty. " +
				'Pass e.g. platforms: [polkadot()] from "@kheopskit/core/polkadot".',
		);
	}

	return Object.assign({}, DEFAULTS, config, { platforms });
};
