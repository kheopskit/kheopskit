import { safeLocalStorage } from "./storage";

/**
 * Storage key for the icon cache in localStorage.
 */
const ICON_CACHE_KEY = "kheopskit-icons";

/**
 * Icon cache type: a map of wallet ID to icon data URI or URL.
 */
type IconCache = Record<string, string>;

/**
 * In-memory cache to avoid repeated localStorage reads.
 */
let memoryCache: IconCache | null = null;

/**
 * Loads the icon cache from localStorage.
 */
const loadCache = (): IconCache => {
	if (memoryCache !== null) return memoryCache;

	try {
		const stored = safeLocalStorage.getItem(ICON_CACHE_KEY);
		memoryCache = stored ? (JSON.parse(stored) as IconCache) : {};
	} catch {
		memoryCache = {};
	}
	return memoryCache;
};

/**
 * Saves the icon cache to localStorage.
 */
const saveCache = (cache: IconCache): void => {
	try {
		safeLocalStorage.setItem(ICON_CACHE_KEY, JSON.stringify(cache));
		memoryCache = cache;
	} catch {
		// localStorage may be full or unavailable
	}
};

/**
 * Gets a cached icon for a wallet.
 * @param walletId - The wallet ID (e.g., "ethereum:io.talisman")
 * @returns The cached icon data URI, or undefined if not cached
 */
export const getCachedIcon = (walletId: string): string | undefined => {
	const cache = loadCache();
	return cache[walletId] || undefined;
};

/**
 * Sets multiple cached icons at once.
 * More efficient than calling setCachedIcon multiple times.
 * @param icons - Map of wallet ID to icon
 */
export const setCachedIcons = (icons: Record<string, string>): void => {
	const cache = loadCache();
	let changed = false;

	for (const [walletId, icon] of Object.entries(icons)) {
		if (icon && cache[walletId] !== icon) {
			cache[walletId] = icon;
			changed = true;
		}
	}

	if (changed) {
		saveCache(cache);
	}
};
