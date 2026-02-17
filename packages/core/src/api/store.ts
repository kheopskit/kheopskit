import { uniq } from "lodash-es";
import { createStore } from "../utils/createStore";
import { cookieStorage, safeLocalStorage } from "../utils/storage";
import { getWalletAccountId } from "../utils/WalletAccountId";
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

type CompactWalletEntry = [WalletId, string, 0 | 1, 0 | 1];
type CompactPolkadotAccountType = 0 | 1 | 2 | 3;
type CompactAccountEntry = [
	WalletId,
	string,
	string | null,
	number | null,
	(CompactPolkadotAccountType | null)?,
];

type CompactStoreV1 = {
	v: 1;
	// autoReconnect
	r?: WalletId[];
	// wallets: [id, name, isConnected(0|1), type(0=injected,1=appKit)?]
	w?: CompactWalletEntry[];
	// accounts: [walletId, address, name?]
	a?: CompactAccountEntry[];
};

const DEFAULT_SETTINGS: KheopskitStoreData = {};

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

/**
 * Cached default store instance.
 * Lazily initialized on first access to be SSR-safe.
 */
let _defaultStore: KheopskitStore | null = null;

/**
 * Gets the default store, creating it on first access.
 * Uses localStorage on client, noop on server.
 * Lazily initialized to avoid SSR issues with module-level code.
 */
export const getDefaultStore = (): KheopskitStore => {
	if (_defaultStore === null) {
		_defaultStore = createKheopskitStore();
	}
	return _defaultStore;
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
			wallet.type === "appKit" ? 1 : 0,
		],
	);

	const accounts = data.cachedAccounts?.map(
		(account): CompactAccountEntry => [
			account.walletId,
			account.address,
			account.name ?? null,
			account.chainId ?? null,
			toCompactPolkadotAccountType(account.polkadotAccountType),
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

	const wallets: CachedWallet[] = (data.w ?? []).map((item) => {
		const [id, name, isConnected, type] = item;
		walletNameMap.set(id, name);
		const { platform } = parseWalletId(id);
		return {
			id,
			platform,
			type: type === 1 ? "appKit" : "injected",
			name,
			isConnected: isConnected === 1,
		};
	});

	const accounts: CachedAccount[] = (data.a ?? []).map((item) => {
		const [walletId, address, name, chainId, polkadotAccountType] = item;
		const { platform } = parseWalletId(walletId);
		return {
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
		};
	});

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
