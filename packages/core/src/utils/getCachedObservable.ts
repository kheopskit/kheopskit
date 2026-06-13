import type { Observable } from "rxjs";

// Anchored on globalThis so the cache stays a single instance even if the
// module is duplicated across bundle chunks (e.g. CJS subpath entries).
const CACHE_SYMBOL = Symbol.for("kheopskit.observableCache");

const getCache = (): Map<string, Observable<unknown>> => {
	const g = globalThis as unknown as Record<
		symbol,
		Map<string, Observable<unknown>> | undefined
	>;
	let cache = g[CACHE_SYMBOL];
	if (!cache) {
		cache = new Map();
		g[CACHE_SYMBOL] = cache;
	}
	return cache;
};

export const getCachedObservable$ = <T, Obs = Observable<T>>(
	key: string,
	create: () => Obs,
): Obs => {
	const cache = getCache();
	if (!cache.has(key)) cache.set(key, create() as Observable<unknown>);

	return cache.get(key) as Obs;
};

/**
 * Clears an observable from the cache.
 * Use when a wallet disconnects or configuration changes.
 */
export const clearCachedObservable = (key: string): void => {
	getCache().delete(key);
};

/**
 * Clears all cached observables.
 * Use when resetting the entire kheopskit state.
 */
export const clearAllCachedObservables = (): void => {
	getCache().clear();
};
