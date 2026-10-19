import type {
	CachedAccount,
	CachedWallet,
	KheopskitConfig,
	KheopskitPlatform,
} from "./types";

/**
 * Whether a cached wallet survives hydration: an injected wallet needs a
 * plugin for its platform, the WalletConnect row needs `config.walletConnect`.
 */
export const acceptsCachedWallet = (
	cached: CachedWallet,
	config: Pick<KheopskitConfig, "platforms" | "walletConnect">,
): boolean =>
	cached.type === "walletconnect"
		? config.walletConnect !== undefined
		: config.platforms.some((p) => p.platform === cached.platform);

/**
 * Whether a cached account survives hydration: its platform needs a plugin,
 * and that plugin's `acceptsCachedAccount` hook, when it has one, must accept
 * it.
 */
export const acceptsCachedAccount = (
	cached: CachedAccount,
	platforms: readonly KheopskitPlatform[],
): boolean => {
	const plugin = platforms.find((p) => p.platform === cached.platform);
	return (
		plugin !== undefined && (plugin.acceptsCachedAccount?.(cached) ?? true)
	);
};
