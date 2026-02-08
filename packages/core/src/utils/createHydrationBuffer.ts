import {
	BehaviorSubject,
	combineLatest,
	filter,
	map,
	Observable,
	Subscription,
	shareReplay,
	startWith,
	take,
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
 * After the grace period (and convergence, if provided):
 * - Only live items are returned
 * - isHydrating becomes false
 *
 * If an `isConverged` function is provided, hydration ends only when BOTH
 * the grace period has elapsed AND the live items have converged with cached
 * items (e.g., all previously-connected wallets have reconnected).
 * A max timeout (6x grace period) prevents infinite hydration.
 *
 * @param cachedItems - Initial cached items from storage
 * @param liveItems$ - Observable of live items as they become available
 * @param gracePeriodMs - Time in ms to wait before syncing to live state
 * @param mergeFn - Function to merge live and cached items during hydration
 * @param isConverged - Optional function to check if live items have caught up to cached items
 */
const createBufferCore = <T>(
	cachedItems: T[],
	liveItems$: Observable<T[]>,
	gracePeriodMs: number,
	mergeFn: (liveItems: T[], cachedItems: T[]) => T[],
	isConverged?: (liveItems: T[], cachedItems: T[]) => boolean,
): Observable<HydrationBufferResult<T>> => {
	// If no grace period or no cached items, just pass through live items
	if (gracePeriodMs <= 0 || cachedItems.length === 0) {
		return liveItems$.pipe(map((items) => ({ items, isHydrating: false })));
	}

	// Wrap in an Observable to properly manage all subscriptions
	return new Observable<HydrationBufferResult<T>>((subscriber) => {
		const subscriptions = new Subscription();

		// Track whether we're still in the hydration grace period
		// Using BehaviorSubject to keep a stateful value that doesn't complete
		const isHydrating$ = new BehaviorSubject(true);

		// Use startWith to emit cached items immediately before any live emissions
		const liveWithInitial$ = liveItems$.pipe(startWith([] as T[]));

		if (isConverged) {
			// With convergence check: hydration ends when timer fires AND live state has caught up
			const timerFired$ = timer(gracePeriodMs).pipe(
				map(() => true),
				startWith(false),
				shareReplay({ bufferSize: 1, refCount: true }),
			);

			// End hydration when timer has fired AND convergence is met
			subscriptions.add(
				combineLatest([liveWithInitial$, timerFired$])
					.pipe(
						filter(([, timerFired]) => timerFired),
						filter(([liveItems]) => isConverged(liveItems, cachedItems)),
						take(1),
					)
					.subscribe(() => {
						isHydrating$.next(false);
					}),
			);

			// Max timeout (6x grace period) to prevent infinite hydration
			// e.g., if auto-reconnect fails, we still end hydration
			subscriptions.add(
				timer(gracePeriodMs * 6).subscribe(() => {
					if (isHydrating$.value) {
						isHydrating$.next(false);
					}
				}),
			);
		} else {
			// Without convergence check: end hydration on timer only
			subscriptions.add(
				timer(gracePeriodMs).subscribe(() => {
					isHydrating$.next(false);
				}),
			);
		}

		subscriptions.add(
			combineLatest([liveWithInitial$, isHydrating$])
				.pipe(
					map(([liveItems, isHydrating]) => {
						if (!isHydrating) {
							// Hydration complete - return only live items
							return { items: liveItems, isHydrating: false };
						}

						return {
							items: mergeFn(liveItems, cachedItems),
							isHydrating: true,
						};
					}),
				)
				.subscribe(subscriber),
		);

		return () => {
			subscriptions.unsubscribe();
			isHydrating$.complete();
		};
	});
};

/**
 * Creates a hydration buffer that merges cached items with live items.
 *
 * During hydration, cached items take precedence over live items with the same key.
 * This preserves the cached connected state (e.g., isConnected: true) while
 * auto-reconnect is still in progress. New live items not in the cache are added.
 *
 * @param cachedItems - Initial cached items from storage
 * @param liveItems$ - Observable of live items as they become available
 * @param gracePeriodMs - Time in ms to wait before syncing to live state
 * @param getKey - Function to extract a unique key from an item
 * @param isConverged - Optional function to check if live items have caught up to cached items
 * @param mergeItem - Optional function to merge a live item with its cached counterpart
 * @param transformCachedOnly - Optional function to transform cached items not yet in the live stream
 */
export const createHydrationBuffer = <T>(
	cachedItems: T[],
	liveItems$: Observable<T[]>,
	gracePeriodMs: number,
	getKey: (item: T) => string,
	isConverged?: (liveItems: T[], cachedItems: T[]) => boolean,
	mergeItem?: (liveItem: T, cachedItem: T) => T,
	transformCachedOnly?: (cachedItem: T) => T,
): Observable<HydrationBufferResult<T>> => {
	return createBufferCore(
		cachedItems,
		liveItems$,
		gracePeriodMs,
		(liveItems, cached) => {
			const cachedByKey = new Map(cached.map((item) => [getKey(item), item]));
			const liveKeys = new Set(liveItems.map(getKey));

			// For items in both live and cached, prefer cached (preserves connected state)
			// but allow mergeItem to customize how they're combined
			// For items only in live (newly discovered), use the live version
			const mergedItems: T[] = liveItems.map((liveItem) => {
				const key = getKey(liveItem);
				const cachedItem = cachedByKey.get(key);
				if (!cachedItem) return liveItem;
				return mergeItem ? mergeItem(liveItem, cachedItem) : cachedItem;
			});

			// Add cached items not yet in the live stream (e.g., extensions not yet detected)
			for (const cachedItem of cached) {
				if (!liveKeys.has(getKey(cachedItem))) {
					const transformed = transformCachedOnly
						? transformCachedOnly(cachedItem)
						: cachedItem;
					mergedItems.push(transformed);
				}
			}

			return mergedItems;
		},
		isConverged,
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
 * @param isConverged - Optional function to check if live accounts have caught up to cached accounts
 */
export const createAccountHydrationBuffer = <T>(
	cachedAccounts: T[],
	liveAccounts$: Observable<T[]>,
	gracePeriodMs: number,
	getWalletId: (account: T) => string,
	isConverged?: (liveAccounts: T[], cachedAccounts: T[]) => boolean,
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
		isConverged,
	);
};
