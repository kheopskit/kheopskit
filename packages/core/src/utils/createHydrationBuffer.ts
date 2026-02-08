import {
	BehaviorSubject,
	combineLatest,
	map,
	type Observable,
	startWith,
	timer,
} from "rxjs";

export type HydrationBufferResult<T> = {
	items: T[];
	isHydrating: boolean;
};

/**
 * Creates a hydration buffer that merges cached items with live items.
 *
 * During the grace period:
 * - Emits cached items immediately (before any live emissions)
 * - As live items arrive, merges them (live replaces cached with same key)
 * - Cached items for keys not yet in live stream are kept
 *
 * After the grace period:
 * - Only live items are returned
 * - isHydrating becomes false
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

			// During hydration: merge cached and live items
			const liveKeys = new Set(liveItems.map(getKey));

			// Start with live items, then add cached items that haven't appeared yet
			const mergedItems: T[] = [...liveItems];

			for (const cachedItem of cachedItems) {
				const key = getKey(cachedItem);
				if (!liveKeys.has(key)) {
					// This cached item hasn't appeared in live yet - keep it
					mergedItems.push(cachedItem);
				}
				// If the item exists in live, we already have it from liveItems
			}

			return { items: mergedItems, isHydrating: true };
		}),
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
 * @param getKey - Function to extract a unique key from an account
 */
export const createAccountHydrationBuffer = <T>(
	cachedAccounts: T[],
	liveAccounts$: Observable<T[]>,
	gracePeriodMs: number,
	getWalletId: (account: T) => string,
): Observable<HydrationBufferResult<T>> => {
	// If no grace period or no cached accounts, just pass through live accounts
	if (gracePeriodMs <= 0 || cachedAccounts.length === 0) {
		return liveAccounts$.pipe(map((items) => ({ items, isHydrating: false })));
	}

	// Track whether we're still in the hydration grace period
	// Using BehaviorSubject to keep a stateful value that doesn't complete
	const isHydrating$ = new BehaviorSubject(true);

	// Set up timer to end hydration but DON'T complete the subject
	timer(gracePeriodMs).subscribe(() => {
		isHydrating$.next(false);
		// Deliberately NOT completing the BehaviorSubject
	});

	// Use startWith to emit cached accounts immediately before any live emissions
	const liveWithInitial$ = liveAccounts$.pipe(startWith([] as T[]));

	return combineLatest([liveWithInitial$, isHydrating$]).pipe(
		map(([liveAccounts, isHydrating]) => {
			if (!isHydrating) {
				// Grace period expired - return only live accounts
				return { items: liveAccounts, isHydrating: false };
			}

			// During hydration: merge cached and live accounts by wallet
			// A wallet "has provided" if we have any live accounts from it
			const walletsWithLiveAccounts = new Set(liveAccounts.map(getWalletId));

			// Start with live accounts
			const mergedAccounts: T[] = [...liveAccounts];

			// Add cached accounts from wallets that haven't provided accounts yet
			for (const cachedAccount of cachedAccounts) {
				const walletId = getWalletId(cachedAccount);
				if (!walletsWithLiveAccounts.has(walletId)) {
					// This wallet hasn't provided accounts yet - keep cached accounts
					mergedAccounts.push(cachedAccount);
				}
			}

			return { items: mergedAccounts, isHydrating: true };
		}),
	);
};
