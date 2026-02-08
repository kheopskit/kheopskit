import { BehaviorSubject, type Observable, type Subscription } from "rxjs";

export const createStore = <T>(
	observable$: Observable<T>,
	initialValue: T,
	serverValue?: T,
) => {
	const subject = new BehaviorSubject<T>(initialValue);
	let subscription: Subscription | null = null;
	let subscriberCount = 0;

	const ensureSubscription = () => {
		if (!subscription || subscription.closed) {
			subscription = observable$.subscribe((value) => {
				subject.next(value);
			});
		}
	};

	// Start subscription immediately
	ensureSubscription();

	const getSnapshot = () => subject.getValue();

	/**
	 * Returns the server-side snapshot for SSR hydration.
	 * This prevents hydration mismatches by providing a consistent
	 * value during server rendering.
	 */
	const getServerSnapshot = () => serverValue ?? initialValue;

	const subscribe = (callback: (value: T) => void) => {
		subscriberCount++;
		// Ensure observable subscription is active when someone subscribes
		ensureSubscription();

		const rxSub = subject.subscribe(callback);

		return () => {
			subscriberCount--;
			rxSub.unsubscribe();
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
