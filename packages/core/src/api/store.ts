import { uniq } from "lodash-es";
import { createStore } from "../utils/createStore";
import { isWalletPlatform } from "../utils/isWalletPlatform";
import { cookieStorage, safeLocalStorage } from "../utils/storage";
import { getWalletAccountId } from "../utils/WalletAccountId";
import {
	isValidWalletId,
	parseWalletId,
	WALLET_CONNECT_WALLET_ID,
	type WalletId,
} from "../utils/WalletId";
import { DEFAULT_STORAGE_KEY } from "./config";
import type { CachedAccount, CachedWallet, WalletPlatform } from "./types";

type KheopskitStoreData = {
	autoReconnect?: WalletId[];
	/** Cached wallet state for SSR hydration to prevent UI flash */
	cachedWallets?: CachedWallet[];
	/** Cached account state for SSR hydration to prevent UI flash */
	cachedAccounts?: CachedAccount[];
};

// wallet type: 0=injected, 1=walletconnect
type CompactWalletEntry = [WalletId, string, 0 | 1, 0 | 1];
type CompactPolkadotAccountType = 0 | 1 | 2 | 3;
// platform: 0=polkadot, 1=ethereum, 2=solana
type CompactPlatformCode = 0 | 1 | 2;
type CompactAccountEntry = [
	WalletId,
	string,
	string | null,
	number | null,
	CompactPolkadotAccountType | null,
	// Platform code. Newly written entries always include it (the WalletConnect
	// connector's walletId is platform-less, so platform can't be derived from
	// it); absent in entries written by older versions, where it's derived from
	// the walletId instead.
	(CompactPlatformCode | null)?,
];

type CompactStoreV1 = {
	v: 1;
	// autoReconnect
	r?: WalletId[];
	// wallets: [id, name, isConnected(0|1), type(0=injected,1=walletconnect)?]
	w?: CompactWalletEntry[];
	// accounts: [walletId, address, name?, chainId?, polkadotType?, platform?]
	a?: CompactAccountEntry[];
};

const DEFAULT_SETTINGS: KheopskitStoreData = {};

/**
 * Validates a cached wallet read from persisted storage. Cached state may have
 * been written by an older (or corrupted) version with a different shape, so we
 * drop anything that wouldn't survive hydration/sort rather than letting it
 * throw at render time. Only the fields downstream code relies on are checked.
 */
const isValidCachedWallet = (value: unknown): value is CachedWallet => {
	if (!value || typeof value !== "object") return false;
	const w = value as Record<string, unknown>;
	if (!isValidWalletId(w.id)) return false;
	if (typeof w.name !== "string" || typeof w.isConnected !== "boolean")
		return false;
	// The WalletConnect connector is platform-less with a fixed id; drop stale
	// per-platform WC entries written by older versions.
	if (w.type === "walletconnect")
		return w.id === WALLET_CONNECT_WALLET_ID && w.platform === undefined;
	return w.type === "injected" && isWalletPlatform(w.platform);
};

/** Validates a cached account read from persisted storage. See {@link isValidCachedWallet}. */
const isValidCachedAccount = (value: unknown): value is CachedAccount => {
	if (!value || typeof value !== "object") return false;
	const a = value as Record<string, unknown>;
	return (
		typeof a.id === "string" &&
		!!a.id &&
		isWalletPlatform(a.platform) &&
		typeof a.address === "string" &&
		!!a.address &&
		isValidWalletId(a.walletId) &&
		typeof a.walletName === "string"
	);
};

const toCompactPolkadotAccountType = (
	type: CachedAccount["polkadotAccountType"],
): CompactPolkadotAccountType | null => {
	switch (type) {
		case "sr25519":
			return 0;
		case "ed25519":
			return 1;
		case "ecdsa":
			return 2;
		case "ethereum":
			return 3;
		default:
			return null;
	}
};

const fromCompactPolkadotAccountType = (
	type: CompactPolkadotAccountType | null | undefined,
): CachedAccount["polkadotAccountType"] => {
	switch (type) {
		case 0:
			return "sr25519";
		case 1:
			return "ed25519";
		case 2:
			return "ecdsa";
		case 3:
			return "ethereum";
		default:
			return undefined;
	}
};

const toCompactPlatform = (platform: WalletPlatform): CompactPlatformCode => {
	switch (platform) {
		case "polkadot":
			return 0;
		case "ethereum":
			return 1;
		case "solana":
			return 2;
	}
};

const fromCompactPlatform = (
	code: CompactPlatformCode | null | undefined,
): WalletPlatform | undefined => {
	switch (code) {
		case 0:
			return "polkadot";
		case 1:
			return "ethereum";
		case 2:
			return "solana";
		default:
			return undefined;
	}
};

type CreateKheopskitStoreOptions = {
	/**
	 * Cookie string for SSR hydration.
	 * When provided, uses cookieStorage instead of localStorage.
	 */
	ssrCookies?: string;
	/**
	 * Custom storage key to namespace the stored data.
	 * @default "kheopskit"
	 */
	storageKey?: string;
};

/**
 * Creates a kheopskit store with the appropriate storage backend.
 * Uses cookieStorage when ssrCookies is provided (for SSR hydration),
 * otherwise falls back to safeLocalStorage.
 *
 * @param options - Configuration options for the store
 */
export const createKheopskitStore = (
	options: CreateKheopskitStoreOptions = {},
) => {
	const { ssrCookies, storageKey = DEFAULT_STORAGE_KEY } = options;
	const storage =
		ssrCookies !== undefined
			? createCompactCookieStorage(ssrCookies)
			: safeLocalStorage;
	const store = createStore(storageKey, DEFAULT_SETTINGS, storage);

	const addEnabledWalletId = (walletId: WalletId) => {
		parseWalletId(walletId); // validate walletId
		store.mutate((prev) => ({
			...prev,
			autoReconnect: uniq((prev.autoReconnect ?? []).concat(walletId)),
		}));
	};

	const removeEnabledWalletId = (walletId: WalletId) => {
		store.mutate((prev) => ({
			...prev,
			autoReconnect: uniq(
				(prev.autoReconnect ?? []).filter((id) => id !== walletId),
			),
		}));
	};

	const getCachedState = () => {
		// `store.get()` returns whatever JSON was persisted — it may be from an
		// older version, a different shape, or outright corrupt. Read defensively:
		// coerce non-objects/arrays to empty and drop any entry that fails
		// validation, so stale cache degrades to "start fresh" instead of throwing
		// during hydration (which renders eagerly, so a throw blanks the dapp).
		const data = store.get() as Partial<KheopskitStoreData> | null | undefined;
		const cachedWallets = Array.isArray(data?.cachedWallets)
			? data.cachedWallets
			: [];
		const cachedAccounts = Array.isArray(data?.cachedAccounts)
			? data.cachedAccounts
			: [];
		return {
			wallets: cachedWallets.filter(isValidCachedWallet),
			accounts: cachedAccounts.filter(isValidCachedAccount),
		};
	};

	const setCachedState = (
		wallets: CachedWallet[],
		accounts: CachedAccount[],
	) => {
		store.mutate((prev) => ({
			...prev,
			cachedWallets: wallets,
			cachedAccounts: accounts,
		}));
	};

	return {
		observable: store.observable,
		addEnabledWalletId,
		removeEnabledWalletId,
		getCachedState,
		setCachedState,
	};
};

export type KheopskitStore = ReturnType<typeof createKheopskitStore>;

/**
 * Cached default store instance, anchored on globalThis so it stays a single
 * instance even if this module is duplicated across bundle chunks (e.g. CJS
 * subpath entries). Lazily initialized on first access to be SSR-safe.
 */
const DEFAULT_STORE_SYMBOL = Symbol.for("kheopskit.defaultStore");

/**
 * Gets the default store, creating it on first access.
 * Uses localStorage on client, noop on server.
 * Lazily initialized to avoid SSR issues with module-level code.
 */
export const getDefaultStore = (): KheopskitStore => {
	const g = globalThis as unknown as Record<symbol, KheopskitStore | undefined>;
	if (!g[DEFAULT_STORE_SYMBOL]) {
		g[DEFAULT_STORE_SYMBOL] = createKheopskitStore();
	}
	return g[DEFAULT_STORE_SYMBOL];
};

/**
 * @deprecated Use createKheopskitStore() or getDefaultStore() instead.
 * This export is kept for backward compatibility but may cause SSR issues
 * if imported at module level in server environments.
 */
export const store = {
	get observable() {
		return getDefaultStore().observable;
	},
	addEnabledWalletId: (walletId: WalletId) =>
		getDefaultStore().addEnabledWalletId(walletId),
	removeEnabledWalletId: (walletId: WalletId) =>
		getDefaultStore().removeEnabledWalletId(walletId),
	getCachedState: () => getDefaultStore().getCachedState(),
	setCachedState: (wallets: CachedWallet[], accounts: CachedAccount[]) =>
		getDefaultStore().setCachedState(wallets, accounts),
};

const isCompactStore = (value: unknown): value is CompactStoreV1 => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	if ("cachedWallets" in value || "cachedAccounts" in value) return false;
	return "v" in value || "w" in value || "a" in value || "r" in value;
};

const toCompactStore = (data: KheopskitStoreData): CompactStoreV1 => {
	const wallets = data.cachedWallets?.map(
		(wallet): CompactWalletEntry => [
			wallet.id,
			wallet.name,
			wallet.isConnected ? 1 : 0,
			wallet.type === "walletconnect" ? 1 : 0,
		],
	);

	const accounts = data.cachedAccounts?.map(
		(account): CompactAccountEntry => [
			account.walletId,
			account.address,
			account.name ?? null,
			account.chainId ?? null,
			toCompactPolkadotAccountType(account.polkadotAccountType),
			toCompactPlatform(account.platform),
		],
	);

	return {
		v: 1,
		r: data.autoReconnect,
		w: wallets?.length ? wallets : undefined,
		a: accounts?.length ? accounts : undefined,
	};
};

const fromCompactStore = (data: CompactStoreV1): KheopskitStoreData => {
	const walletNameMap = new Map<WalletId, string>();

	// Decode defensively: a compact payload may be malformed (older/corrupt
	// cookie, hand-edited). Skip entries with an unparseable wallet id rather
	// than throwing, which would crash store initialisation.
	const wallets: CachedWallet[] = [];
	for (const item of Array.isArray(data.w) ? data.w : []) {
		if (!Array.isArray(item)) continue;
		const [id, name, isConnected, type] = item;
		if (!isValidWalletId(id)) continue;
		const isWalletConnect = id === WALLET_CONNECT_WALLET_ID;
		const walletType = type === 1 ? "walletconnect" : "injected";
		// Keep id/type consistent: the platform-less connector uses the fixed WC
		// id; everything else is a platform-prefixed injected wallet. Drop stale
		// mismatches (e.g. per-platform WC ids from older versions).
		if (isWalletConnect !== (walletType === "walletconnect")) continue;
		walletNameMap.set(id, name);
		wallets.push({
			id,
			platform: isWalletConnect ? undefined : parseWalletId(id).platform,
			type: walletType,
			name,
			isConnected: isConnected === 1,
		});
	}

	const accounts: CachedAccount[] = [];
	for (const item of Array.isArray(data.a) ? data.a : []) {
		if (!Array.isArray(item)) continue;
		const [
			walletId,
			address,
			name,
			chainId,
			polkadotAccountType,
			platformCode,
		] = item;
		if (!isValidWalletId(walletId) || typeof address !== "string" || !address)
			continue;
		// Prefer the explicit platform code; fall back to deriving it from the
		// walletId for entries written before the code existed (never WC ones).
		const platform =
			platformCode != null
				? fromCompactPlatform(platformCode)
				: walletId === WALLET_CONNECT_WALLET_ID
					? undefined
					: parseWalletId(walletId).platform;
		if (!isWalletPlatform(platform)) continue;
		accounts.push({
			id: getWalletAccountId(walletId, address),
			platform,
			address,
			name: name ?? undefined,
			chainId: chainId ?? undefined,
			polkadotAccountType:
				platform === "polkadot"
					? fromCompactPolkadotAccountType(polkadotAccountType)
					: undefined,
			walletId,
			walletName: walletNameMap.get(walletId) ?? walletId,
		});
	}

	return {
		autoReconnect: data.r,
		cachedWallets: wallets,
		cachedAccounts: accounts,
	};
};

const decodeStore = (raw: string, fallback: KheopskitStoreData) => {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (isCompactStore(parsed)) return fromCompactStore(parsed);
		return parsed as KheopskitStoreData;
	} catch {
		return fallback;
	}
};

const encodeStore = (data: KheopskitStoreData): string =>
	JSON.stringify(toCompactStore(data));

const createCompactCookieStorage = (initialCookies?: string) => {
	const base = cookieStorage(initialCookies);

	return {
		getItem: (key: string) => {
			const raw = base.getItem(key);
			if (!raw) return null;
			const expanded = decodeStore(raw, DEFAULT_SETTINGS);
			if (typeof document !== "undefined") {
				try {
					const parsed = JSON.parse(raw) as unknown;
					if (!isCompactStore(parsed)) {
						base.setItem(key, encodeStore(expanded));
					}
				} catch {
					// Ignore malformed cookie during migration
				}
			}
			return JSON.stringify(expanded);
		},
		setItem: (key: string, value: string) => {
			const expanded = decodeStore(value, DEFAULT_SETTINGS);
			base.setItem(key, encodeStore(expanded));
		},
		removeItem: base.removeItem,
		subscribe: (key: string, callback: (value: string | null) => void) => {
			const unsubscribe = base.subscribe?.(key, (value) => {
				if (!value) {
					callback(null);
					return;
				}
				const expanded = decodeStore(value, DEFAULT_SETTINGS);
				callback(JSON.stringify(expanded));
			});
			return () => {
				unsubscribe?.();
			};
		},
	};
};
