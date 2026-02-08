import type { Observable } from "rxjs";

const CACHE = new Map<string, Observable<unknown>>();

export const getCachedObservable$ = <T, Obs = Observable<T>>(
	key: string,
	create: () => Obs,
): Obs => {
	if (!CACHE.has(key)) CACHE.set(key, create() as Observable<unknown>);

	return CACHE.get(key) as Obs;
};

/**
 * Clears an observable from the cache.
 * Use when a wallet disconnects or configuration changes.
 */
export const clearCachedObservable = (key: string): void => {
	CACHE.delete(key);
};

/**
 * Clears all cached observables.
 * Use when resetting the entire kheopskit state.
 */
export const clearAllCachedObservables = (): void => {
	CACHE.clear();
};
