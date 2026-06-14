import type { CachedAccount, KheopskitPlatform } from "./types";

/**
 * Whether a cached account should survive SSR hydration, per its platform
 * plugin's `acceptsCachedAccount` hook. Plugins without the hook (and platforms
 * with no enabled plugin) accept all — matching the pre-plugin behavior where
 * only Polkadot accounts were filtered (by key type).
 */
export const acceptsCachedAccount = (
	cached: CachedAccount,
	platforms: readonly KheopskitPlatform[],
): boolean => {
	const plugin = platforms.find((p) => p.platform === cached.platform);
	return plugin?.acceptsCachedAccount?.(cached) ?? true;
};
