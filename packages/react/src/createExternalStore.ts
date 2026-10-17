import type { Observable, Subscription } from "rxjs";

export type ExternalStoreSource<T> = {
	observable$: Observable<T>;
	initialValue: T;
};

/**
 * React calls only `getServerSnapshot` on the server, so `resolveSource` runs
 * on the client alone, on the first `getSnapshot` or `subscribe`.
 */
export const createExternalStore = <T>(
	resolveSource: () => ExternalStoreSource<T>,
	serverValue: T,
) => {
	let source: ExternalStoreSource<T> | undefined;
	let latestValue: T | undefined;
	let subscription: Subscription | undefined;
	const listeners = new Set<(value: T) => void>();

	const getSource = () => {
		source ??= resolveSource();
		return source;
	};

	const getSnapshot = () => latestValue ?? getSource().initialValue;

	const getServerSnapshot = () => serverValue;

	const releaseWhenUnobserved = () => {
		if (listeners.size) return;
		subscription?.unsubscribe();
		subscription = undefined;
	};

	const subscribe = (listener: (value: T) => void) => {
		if (!subscription || subscription.closed)
			subscription = getSource().observable$.subscribe((value) => {
				latestValue = value;
				for (const notify of listeners) notify(value);
			});
		listeners.add(listener);
		listener(getSnapshot());

		return () => {
			listeners.delete(listener);
			// StrictMode and a changed `subscribe` unsubscribe and resubscribe in
			// the same task; releasing at once would restart the source between.
			queueMicrotask(releaseWhenUnobserved);
		};
	};

	return { getSnapshot, getServerSnapshot, subscribe };
};
