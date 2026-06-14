import type { Observable, Subscription } from "rxjs";

export const createStore = <T>(
	observable$: Observable<T>,
	initialValue: T,
	serverValue?: T,
) => {
	// Use null as sentinel to indicate we haven't received first emission yet
	let latestValue: T | null = null;
	let subscription: Subscription | null = null;
	let subscriberCount = 0;
	const listeners = new Set<(value: T) => void>();

	const ensureSubscription = () => {
		if (!subscription || subscription.closed) {
			subscription = observable$.subscribe((value) => {
				latestValue = value;
				for (const listener of listeners) {
					listener(value);
				}
			});
		}
	};

	// The subscription is created lazily by subscribe() (which React calls from a
	// committed passive effect), never during render. React may render a tree and
	// throw it away without committing — StrictMode double-invokes the initial
	// render, and concurrent/Suspense can discard renders — so subscribing eagerly
	// here (createStore runs inside the Provider's render-phase useMemo) would leak
	// the discarded store's observable subscription. Until the first emission,
	// getSnapshot falls back to initialValue.
	const getSnapshot = () => latestValue ?? initialValue;

	/**
	 * Returns the server-side snapshot for SSR hydration.
	 * This prevents hydration mismatches by providing a consistent
	 * value during server rendering. Must return the same value as
	 * what the server rendered.
	 */
	const getServerSnapshot = () => serverValue ?? initialValue;

	const subscribe = (callback: (value: T) => void) => {
		subscriberCount++;
		// Subscribe to the observable BEFORE registering this listener, so a
		// synchronous replay (BehaviorSubject / shareReplay) updates latestValue
		// without double-invoking this callback — the current value is emitted once,
		// explicitly, just below.
		ensureSubscription();
		listeners.add(callback);

		// Immediately emit current value (BehaviorSubject semantics)
		callback(getSnapshot());

		return () => {
			subscriberCount--;
			listeners.delete(callback);
			// Don't close the observable subscription on unsubscribe
			// Let destroy() handle that when the store is truly being disposed
		};
	};

	const destroy = () => {
		// Only unsubscribe if no one is listening
		// React StrictMode may call destroy and then immediately resubscribe
		if (subscriberCount === 0 && subscription) {
			subscription.unsubscribe();
			subscription = null;
		}
	};

	return {
		getSnapshot,
		getServerSnapshot,
		subscribe,
		destroy,
	};
};
