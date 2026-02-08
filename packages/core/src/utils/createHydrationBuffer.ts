import {
	BehaviorSubject,
	combineLatest,
	map,
	type Observable,
	startWith,
	timer,
} from "rxjs";

type HydrationBufferResult<T> = {
	items: T[];
	isHydrating: boolean;
};

/**
 * Core hydration buffer logic shared between wallets and accounts.
 *
 * During the grace period:
 * - Emits cached items immediately (before any live emissions)
 * - As live items arrive, merges them using the provided merge function
 *
 * After the grace period:
 * - Only live items are returned
 * - isHydrating becomes false
 *
 * @param cachedItems - Initial cached items from storage
 * @param liveItems$ - Observable of live items as they become available
 * @param gracePeriodMs - Time in ms to wait before syncing to live state
 * @param mergeFn - Function to merge live and cached items during hydration
 */
const createBufferCore = <T>(
	cachedItems: T[],
	liveItems$: Observable<T[]>,
	gracePeriodMs: number,
	mergeFn: (liveItems: T[], cachedItems: T[]) => T[],
): Observable<HydrationBufferResult<T>> => {
	// If no grace period or no cached items, just pass through live items
	if (gracePeriodMs <= 0 || cachedItems.length === 0) {
		return liveItems$.pipe(map((items) => ({ items, isHydrating: false })));
	}

	// Track whether we're still in the hydration grace period
	// Using BehaviorSubject to keep a stateful value that doesn't complete
	const isHydrating$ = new BehaviorSubject(true);

	// Set up timer to end hydration but DON'T complete the subject
	timer(gracePeriodMs).subscribe(() => {
		isHydrating$.next(false);
		// Deliberately NOT completing the BehaviorSubject
	});

	// Use startWith to emit cached items immediately before any live emissions
	const liveWithInitial$ = liveItems$.pipe(startWith([] as T[]));

	return combineLatest([liveWithInitial$, isHydrating$]).pipe(
		map(([liveItems, isHydrating]) => {
			if (!isHydrating) {
				// Grace period expired - return only live items
				return { items: liveItems, isHydrating: false };
			}

			return { items: mergeFn(liveItems, cachedItems), isHydrating: true };
		}),
	);
};

/**
 * Creates a hydration buffer that merges cached items with live items.
 *
 * During hydration, live items take precedence over cached items with the same key.
 * Cached items for keys not yet in the live stream are preserved.
 *
 * @param cachedItems - Initial cached items from storage
 * @param liveItems$ - Observable of live items as they become available
 * @param gracePeriodMs - Time in ms to wait before syncing to live state
 * @param getKey - Function to extract a unique key from an item
 */
export const createHydrationBuffer = <T>(
	cachedItems: T[],
	liveItems$: Observable<T[]>,
	gracePeriodMs: number,
	getKey: (item: T) => string,
): Observable<HydrationBufferResult<T>> => {
	return createBufferCore(
		cachedItems,
		liveItems$,
		gracePeriodMs,
		(liveItems, cached) => {
			const liveKeys = new Set(liveItems.map(getKey));
			const mergedItems: T[] = [...liveItems];

			for (const cachedItem of cached) {
				if (!liveKeys.has(getKey(cachedItem))) {
					mergedItems.push(cachedItem);
				}
			}

			return mergedItems;
		},
	);
};

/**
 * Creates a hydration buffer specifically for accounts, which need special handling.
 *
 * Accounts are grouped by wallet - when a wallet provides its account list,
 * we replace all cached accounts for that wallet with the live ones.
 * Cached accounts for wallets that haven't provided accounts yet are preserved.
 *
 * @param cachedAccounts - Initial cached accounts from storage
 * @param liveAccounts$ - Observable of live accounts as they become available
 * @param gracePeriodMs - Time in ms to wait before syncing to live state
 * @param getWalletId - Function to extract the wallet ID from an account
 */
export const createAccountHydrationBuffer = <T>(
	cachedAccounts: T[],
	liveAccounts$: Observable<T[]>,
	gracePeriodMs: number,
	getWalletId: (account: T) => string,
): Observable<HydrationBufferResult<T>> => {
	return createBufferCore(
		cachedAccounts,
		liveAccounts$,
		gracePeriodMs,
		(liveAccounts, cached) => {
			const walletsWithLiveAccounts = new Set(liveAccounts.map(getWalletId));
			const mergedAccounts: T[] = [...liveAccounts];

			for (const cachedAccount of cached) {
				if (!walletsWithLiveAccounts.has(getWalletId(cachedAccount))) {
					mergedAccounts.push(cachedAccount);
				}
			}

			return mergedAccounts;
		},
	);
};
