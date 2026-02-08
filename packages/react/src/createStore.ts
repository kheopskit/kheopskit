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

	// Start subscription immediately
	ensureSubscription();

	// If observable emitted synchronously, use that value
	// Otherwise fall back to initialValue
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
		listeners.add(callback);
		// Ensure observable subscription is active when someone subscribes
		ensureSubscription();

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
