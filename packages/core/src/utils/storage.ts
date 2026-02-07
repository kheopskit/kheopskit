export type Storage = {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
	removeItem: (key: string) => void;
};

/**
 * Extended storage interface with cross-tab sync support.
 */
export type SyncableStorage = Storage & {
	/**
	 * Subscribe to storage changes from other tabs.
	 * Returns an unsubscribe function.
	 */
	subscribe?: (key: string, callback: (value: string | null) => void) => () => void;
};

/**
 * A no-op storage implementation that does nothing.
 * Useful for testing or SSR environments where no storage is needed.
 */
export const noopStorage: SyncableStorage = {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {},
};

/**
 * A safe localStorage wrapper that falls back to noopStorage
 * when localStorage is not available (e.g., during SSR).
 * Includes cross-tab sync via the native 'storage' event.
 */
export const safeLocalStorage: SyncableStorage = (() => {
	if (typeof window === "undefined") return noopStorage;

	try {
		// Test that localStorage is accessible (may throw in private browsing)
		const testKey = "__kheopskit_test__";
		window.localStorage.setItem(testKey, testKey);
		window.localStorage.removeItem(testKey);

		return {
			getItem: (key: string) => window.localStorage.getItem(key),
			setItem: (key: string, value: string) =>
				window.localStorage.setItem(key, value),
			removeItem: (key: string) => window.localStorage.removeItem(key),
			subscribe: (key: string, callback: (value: string | null) => void) => {
				const handler = (event: StorageEvent) => {
					if (event.key === key) {
						callback(event.newValue);
					}
				};
				window.addEventListener("storage", handler);
				return () => window.removeEventListener("storage", handler);
			},
		};
	} catch {
		return noopStorage;
	}
})();

/**
 * Parse a cookie string to extract the value for a specific key.
 * @param cookieString - The full cookie header string (e.g., document.cookie or req.headers.cookie)
 * @param key - The cookie key to find
 * @returns The cookie value or null if not found
 */
export const parseCookie = (
	cookieString: string | undefined,
	key: string,
): string | null => {
	if (!cookieString) return null;

	const cookies = cookieString.split(";").reduce(
		(acc, cookie) => {
			const [k, ...v] = cookie.split("=");
			const key = k?.trim();
			if (key) {
				acc[key] = decodeURIComponent(v.join("=").trim());
			}
			return acc;
		},
		{} as Record<string, string>,
	);

	return cookies[key] ?? null;
};

/**
 * Maximum recommended size for cookie storage (3KB to stay well under 4KB limit).
 * Cookies exceeding this may be rejected by browsers or cause issues.
 */
export const COOKIE_MAX_SIZE = 3 * 1024;

/**
 * BroadcastChannel name for cross-tab cookie sync.
 */
const BROADCAST_CHANNEL_NAME = "kheopskit-storage-sync";

/**
 * A cookie-based storage implementation for SSR environments.
 * Reads cookies from an optional initial cookie string (for SSR hydration),
 * writes to document.cookie on the client.
 *
 * Features:
 * - Secure flag automatically added for HTTPS connections
 * - Cross-tab synchronization via BroadcastChannel API
 * - Size limit warning when data exceeds recommended limits
 *
 * @param initialCookies - Optional cookie string for server-side hydration
 */
export const cookieStorage = (initialCookies?: string): SyncableStorage => {
	// Create BroadcastChannel for cross-tab sync (if available)
	let broadcastChannel: BroadcastChannel | null = null;
	if (typeof BroadcastChannel !== "undefined") {
		try {
			broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
		} catch {
			// BroadcastChannel not supported or failed
		}
	}

	const isSecure =
		typeof window !== "undefined" && window.location.protocol === "https:";

	return {
		getItem: (key: string) => {
			// On server, use initialCookies. On client, read from document.cookie
			const cookieString =
				typeof document !== "undefined" ? document.cookie : initialCookies;
			return parseCookie(cookieString, key);
		},
		setItem: (key: string, value: string) => {
			if (typeof document === "undefined") return;

			// Warn if value exceeds recommended size
			const encodedValue = encodeURIComponent(value);
			if (encodedValue.length > COOKIE_MAX_SIZE) {
				console.warn(
					`[kheopskit] Cookie value for "${key}" exceeds recommended size limit (${encodedValue.length} > ${COOKIE_MAX_SIZE} bytes). ` +
						"This may cause issues with cookie storage. Consider reducing the number of connected wallets.",
				);
			}

			// Set cookie with 1 year expiry
			const expires = new Date();
			expires.setFullYear(expires.getFullYear() + 1);

			// Build cookie string with security attributes
			let cookieStr = `${key}=${encodedValue};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
			if (isSecure) {
				cookieStr += ";Secure";
			}

			// biome-ignore lint: necessary for cookie storage - direct cookie assignment is the standard API
			document.cookie = cookieStr;

			// Broadcast change to other tabs
			broadcastChannel?.postMessage({ type: "set", key, value });
		},
		removeItem: (key: string) => {
			if (typeof document === "undefined") return;

			// Build delete cookie string
			let cookieStr = `${key}=;expires=Thu, 01 Jan 1970 00:00:01 GMT;path=/;SameSite=Lax`;
			if (isSecure) {
				cookieStr += ";Secure";
			}

			// biome-ignore lint: necessary for cookie storage - direct cookie assignment is the standard API
			document.cookie = cookieStr;

			// Broadcast change to other tabs
			broadcastChannel?.postMessage({ type: "remove", key });
		},
		subscribe: (key: string, callback: (value: string | null) => void) => {
			if (!broadcastChannel) return () => {};

			const handler = (event: MessageEvent) => {
				const data = event.data as { type: string; key: string; value?: string };
				if (data.key === key) {
					if (data.type === "set") {
						callback(data.value ?? null);
					} else if (data.type === "remove") {
						callback(null);
					}
				}
			};

			broadcastChannel.addEventListener("message", handler);
			return () => {
				broadcastChannel?.removeEventListener("message", handler);
			};
		},
	};
};
