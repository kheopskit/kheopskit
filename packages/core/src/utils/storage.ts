export type Storage = {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
	removeItem: (key: string) => void;
};

/**
 * A no-op storage implementation that does nothing.
 * Useful for testing or SSR environments where no storage is needed.
 */
export const noopStorage: Storage = {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {},
};

/**
 * A safe localStorage wrapper that falls back to noopStorage
 * when localStorage is not available (e.g., during SSR).
 */
export const safeLocalStorage: Storage = (() => {
	if (typeof window === "undefined") return noopStorage;

	try {
		// Test that localStorage is accessible (may throw in private browsing)
		const testKey = "__kheopskit_test__";
		window.localStorage.setItem(testKey, testKey);
		window.localStorage.removeItem(testKey);
		return window.localStorage;
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
 * A cookie-based storage implementation for SSR environments.
 * Reads cookies from an optional initial cookie string (for SSR hydration),
 * writes to document.cookie on the client.
 *
 * @param initialCookies - Optional cookie string for server-side hydration
 */
export const cookieStorage = (initialCookies?: string): Storage => {
	return {
		getItem: (key: string) => {
			// On server, use initialCookies. On client, read from document.cookie
			const cookieString =
				typeof document !== "undefined" ? document.cookie : initialCookies;
			return parseCookie(cookieString, key);
		},
		setItem: (key: string, value: string) => {
			if (typeof document === "undefined") return;
			// Set cookie with 1 year expiry, SameSite=Lax for security
			const expires = new Date();
			expires.setFullYear(expires.getFullYear() + 1);
			// biome-ignore lint: necessary for cookie storage - direct cookie assignment is the standard API
			document.cookie = `${key}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
		},
		removeItem: (key: string) => {
			if (typeof document === "undefined") return;
			// Delete cookie by setting expiry in the past
			// biome-ignore lint: necessary for cookie storage - direct cookie assignment is the standard API
			document.cookie = `${key}=;expires=Thu, 01 Jan 1970 00:00:01 GMT;path=/;SameSite=Lax`;
		},
	};
};
