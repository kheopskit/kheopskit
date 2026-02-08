import { uniq } from "lodash-es";
import { createStore } from "../utils/createStore";
import { cookieStorage, safeLocalStorage } from "../utils/storage";
import { parseWalletId, type WalletId } from "../utils/WalletId";
import { DEFAULT_STORAGE_KEY } from "./config";
import type { CachedAccount, CachedWallet } from "./types";

type KheopskitStoreData = {
	autoReconnect?: WalletId[];
	/** Cached wallet state for SSR hydration to prevent UI flash */
	cachedWallets?: CachedWallet[];
	/** Cached account state for SSR hydration to prevent UI flash */
	cachedAccounts?: CachedAccount[];
};

const DEFAULT_SETTINGS: KheopskitStoreData = {};

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
		ssrCookies !== undefined ? cookieStorage(ssrCookies) : safeLocalStorage;
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
		const data = store.get();
		return {
			wallets: data.cachedWallets ?? [],
			accounts: data.cachedAccounts ?? [],
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

// Default store for backward compatibility (uses localStorage on client, noop on server)
export const store = createKheopskitStore();
