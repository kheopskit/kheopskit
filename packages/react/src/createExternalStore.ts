import type { Observable, Subscription } from "rxjs";

export const createExternalStore = <T>(
	source$: Observable<T>,
	getInitialValue: () => T,
	serverValue: T,
) => {
	let initialValue: T | undefined;
	let latestValue: T | undefined;
	let subscription: Subscription | undefined;
	const listeners = new Set<(value: T) => void>();

	const getSnapshot = () => {
		initialValue ??= getInitialValue();
		return latestValue ?? initialValue;
	};

	const getServerSnapshot = () => serverValue;

	const releaseWhenUnobserved = () => {
		if (listeners.size) return;
		subscription?.unsubscribe();
		subscription = undefined;
	};

	const subscribe = (listener: (value: T) => void) => {
		if (!subscription || subscription.closed) {
			subscription = source$.subscribe((value) => {
				latestValue = value;
				for (const notify of listeners) notify(value);
			});
		}
		listeners.add(listener);
		listener(getSnapshot());

		return () => {
			listeners.delete(listener);
			// StrictMode and a changed `subscribe` unsubscribe and resubscribe in
			// the same task; releasing at once would restart the pipeline between.
			queueMicrotask(releaseWhenUnobserved);
		};
	};

	return { getSnapshot, getServerSnapshot, subscribe };
};
