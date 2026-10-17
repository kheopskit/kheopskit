import {
	BehaviorSubject,
	combineLatest,
	filter,
	map,
	Observable,
	Subscription,
	startWith,
	take,
	timer,
} from "rxjs";

type HydrationBufferResult<T> = {
	items: T[];
	isHydrating: boolean;
};

const createBufferCore = <T>(
	cachedItems: T[],
	liveItems$: Observable<T[]>,
	gracePeriodMs: number,
	timeoutMs: number,
	mergeFn: (liveItems: T[], cachedItems: T[]) => T[],
	settled$?: Observable<boolean>,
): Observable<HydrationBufferResult<T>> => {
	if (gracePeriodMs <= 0 || cachedItems.length === 0) {
		return liveItems$.pipe(map((items) => ({ items, isHydrating: false })));
	}

	return new Observable<HydrationBufferResult<T>>((subscriber) => {
		const subscriptions = new Subscription();
		const isHydrating$ = new BehaviorSubject(true);
		const endHydration = () => {
			if (isHydrating$.value) isHydrating$.next(false);
		};

		const graceElapsed$ = timer(gracePeriodMs).pipe(
			map(() => true),
			startWith(false),
		);
		const ended$: Observable<unknown> = settled$
			? combineLatest([graceElapsed$, settled$]).pipe(
					filter(([graceElapsed, settled]) => graceElapsed && settled),
					take(1),
				)
			: timer(gracePeriodMs);
		subscriptions.add(ended$.subscribe(endHydration));
		subscriptions.add(timer(timeoutMs).subscribe(endHydration));

		subscriptions.add(
			combineLatest([liveItems$.pipe(startWith([] as T[])), isHydrating$])
				.pipe(
					map(([liveItems, isHydrating]) =>
						isHydrating
							? { items: mergeFn(liveItems, cachedItems), isHydrating }
							: { items: liveItems, isHydrating },
					),
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
 * @param gracePeriodMs - Minimum time in ms the cached items are shown
 * @param timeoutMs - Upper bound in ms on hydration
 * @param getKey - Function to extract a unique key from an item
 * @param settled$ - Whether the live state has caught up with the cache
 * @param mergeItem - Optional function to merge a live item with its cached counterpart
 * @param transformCachedOnly - Optional function to transform cached items not yet in the live stream
 */
export const createHydrationBuffer = <T>(
	cachedItems: T[],
	liveItems$: Observable<T[]>,
	gracePeriodMs: number,
	timeoutMs: number,
	getKey: (item: T) => string,
	settled$?: Observable<boolean>,
	mergeItem?: (liveItem: T, cachedItem: T) => T,
	transformCachedOnly?: (cachedItem: T) => T,
): Observable<HydrationBufferResult<T>> => {
	return createBufferCore(
		cachedItems,
		liveItems$,
		gracePeriodMs,
		timeoutMs,
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
		settled$,
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
 * @param gracePeriodMs - Minimum time in ms the cached accounts are shown
 * @param timeoutMs - Upper bound in ms on hydration
 * @param getWalletId - Function to extract the wallet ID from an account
 * @param settled$ - Whether the live state has caught up with the cache
 */
export const createAccountHydrationBuffer = <T>(
	cachedAccounts: T[],
	liveAccounts$: Observable<T[]>,
	gracePeriodMs: number,
	timeoutMs: number,
	getWalletId: (account: T) => string,
	settled$?: Observable<boolean>,
): Observable<HydrationBufferResult<T>> => {
	return createBufferCore(
		cachedAccounts,
		liveAccounts$,
		gracePeriodMs,
		timeoutMs,
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
		settled$,
	);
};
