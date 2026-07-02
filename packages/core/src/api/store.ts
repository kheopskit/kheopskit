import { uniq } from "lodash-es";
import { createStore } from "../utils/createStore";
import { isWalletPlatform } from "../utils/isWalletPlatform";
import { safeLocalStorage } from "../utils/storage";
import {
	isValidWalletId,
	parseWalletId,
	WALLET_CONNECT_WALLET_ID,
	type WalletId,
} from "../utils/WalletId";
import { createCompactCookieStorage } from "./compactStore";
import { DEFAULT_STORAGE_KEY } from "./config";
import type {
	CachedAccount,
	CachedWallet,
	KheopskitStore,
	KheopskitStoreData,
} from "./types";

export type { KheopskitStore } from "./types";

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
): KheopskitStore => {
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
