import type { Observable, Subscription } from "rxjs";

export type ExternalStoreSource<T> = {
	observable$: Observable<T>;
	initialValue: T;
};

export const createExternalStore = <T>(
	resolveClientSource: () => ExternalStoreSource<T>,
	serverValue: T,
) => {
	let source: ExternalStoreSource<T> | undefined;
	let latestValue: T | undefined;
	let subscription: Subscription | undefined;
	let generation = 0;
	let snapshotGeneration = 0;
	const listeners = new Set<(value: T) => void>();

	const getSource = () => {
		source ??= resolveClientSource();
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
		if (!subscription || subscription.closed) {
			const run = ++generation;
			subscription = getSource().observable$.subscribe((value) => {
				latestValue = value;
				snapshotGeneration = run;
				for (const notify of listeners) notify(value);
			});
		}
		listeners.add(listener);
		listener(getSnapshot());

		return () => {
			listeners.delete(listener);
			// StrictMode and a changed `subscribe` unsubscribe and resubscribe in
			// the same task; releasing at once would restart the source between.
			queueMicrotask(releaseWhenUnobserved);
		};
	};

	const getSnapshotGeneration = () => snapshotGeneration;

	return { getSnapshot, getServerSnapshot, getSnapshotGeneration, subscribe };
};
