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
	polkadotAccountTypes: ["sr25519", "ed25519", "ecdsa"],
	debug: false,
	storageKey: DEFAULT_STORAGE_KEY,
	hydrationGracePeriod: 500,
};

const VALID_POLKADOT_ACCOUNT_TYPES = new Set<string>([
	"sr25519",
	"ed25519",
	"ecdsa",
	"ethereum",
]);

export const resolveConfig = (
	config: Partial<KheopskitConfig> | undefined,
): KheopskitConfig => {
	const resolved = Object.assign({}, DEFAULT_CONFIG, config);

	const invalid = resolved.polkadotAccountTypes.filter(
		(t) => !VALID_POLKADOT_ACCOUNT_TYPES.has(t),
	);
	if (invalid.length > 0) {
		console.warn(
			`[kheopskit] Unknown polkadotAccountTypes: ${JSON.stringify(invalid)}. Valid values: "sr25519", "ed25519", "ecdsa", "ethereum".`,
		);
	}

	return resolved;
};
