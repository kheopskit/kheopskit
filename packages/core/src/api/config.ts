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

	// Guard the v4 breaking change: platforms are plugin instances, not strings.
	// Catches JS callers (no tsc) and gives agents a fix that names the doc.
	const invalidPlatforms = (platforms as readonly unknown[]).filter(
		(p) =>
			typeof p !== "object" ||
			p === null ||
			typeof (p as { getWallets$?: unknown }).getWallets$ !== "function",
	);
	if (invalidPlatforms.length > 0) {
		throw new Error(
			"[kheopskit] config.platforms must contain plugin instances created by the " +
				"per-platform factories (e.g. platforms: [polkadot(), ethereum(), solana()] " +
				'imported from "@kheopskit/core/<platform>"). ' +
				`Invalid entries: ${JSON.stringify(invalidPlatforms)}. ` +
				'String platform names like "polkadot" were removed in v4 — see MIGRATING_TO_V4.md.',
		);
	}

	if (platforms.length === 0) {
		console.warn(
			"[kheopskit] No platforms configured; wallets and accounts will be empty. " +
				'Pass e.g. platforms: [polkadot()] from "@kheopskit/core/polkadot".',
		);
	}

	return Object.assign({}, DEFAULTS, config, { platforms });
};
