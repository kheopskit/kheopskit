import type {
	CachedAccount,
	CachedWallet,
	KheopskitConfig,
	KheopskitPlatform,
} from "./types";

export const acceptsCachedWallet = (
	cached: CachedWallet,
	config: Pick<KheopskitConfig, "platforms" | "walletConnect">,
): boolean =>
	cached.type === "walletconnect"
		? config.walletConnect !== undefined
		: config.platforms.some((p) => p.platform === cached.platform);

export const acceptsCachedAccount = (
	cached: CachedAccount,
	platforms: readonly KheopskitPlatform[],
): boolean => {
	const plugin = platforms.find((p) => p.platform === cached.platform);
	return (
		plugin !== undefined && (plugin.acceptsCachedAccount?.(cached) ?? true)
	);
};
