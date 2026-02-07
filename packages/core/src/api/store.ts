import { uniq } from "lodash";
import { createStore } from "../utils/createStore";
import { cookieStorage, safeLocalStorage } from "../utils/storage";
import { parseWalletId, type WalletId } from "../utils/WalletId";

const STORAGE_KEY = "kheopskit";

export type KheopskitStoreData = {
	autoReconnect?: WalletId[];
};

const DEFAULT_SETTINGS: KheopskitStoreData = {};

/**
 * Creates a kheopskit store with the appropriate storage backend.
 * Uses cookieStorage when ssrCookies is provided (for SSR hydration),
 * otherwise falls back to safeLocalStorage.
 */
export const createKheopskitStore = (ssrCookies?: string) => {
	const storage = ssrCookies ? cookieStorage(ssrCookies) : safeLocalStorage;
	const store = createStore(STORAGE_KEY, DEFAULT_SETTINGS, storage);

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

	return {
		observable: store.observable,
		addEnabledWalletId,
		removeEnabledWalletId,
	};
};

export type KheopskitStore = ReturnType<typeof createKheopskitStore>;

// Default store for backward compatibility (uses localStorage on client, noop on server)
export const store = createKheopskitStore();
