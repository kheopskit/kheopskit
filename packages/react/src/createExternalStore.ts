import type { Observable, Subscription } from "rxjs";

export type ExternalStoreSource<T> = {
	observable$: Observable<T>;
	initialValue: T;
};

// React runs every layout setup of a commit synchronously, so once this
// microtask runs a mounted provider has taken its hold on the source.
const afterThisCommitsLayoutEffects = () => Promise.resolve();

export const createExternalStore = <T>(
	resolveClientSource: () => ExternalStoreSource<T>,
	serverValue: T,
) => {
	let source: ExternalStoreSource<T> | undefined;
	let latestValue: T | undefined;
	let subscription: Subscription | undefined;
	let run = 0;
	let emittedRun = 0;
	const listeners = new Set<(value: T) => void>();
	const firstEmissionWaiters = new Set<(value: T | undefined) => void>();

	const getSource = () => {
		source ??= resolveClientSource();
		return source;
	};

	const getSnapshot = () => latestValue ?? getSource().initialValue;

	const getServerSnapshot = () => serverValue;

	const settleFirstEmission = (value: T | undefined) => {
		for (const waiter of firstEmissionWaiters) waiter(value);
	};

	const releaseWhenUnobserved = () => {
		if (listeners.size) return;
		subscription?.unsubscribe();
		subscription = undefined;
		settleFirstEmission(undefined);
	};

	const subscribe = (listener: (value: T) => void) => {
		if (!subscription || subscription.closed) {
			const thisRun = ++run;
			subscription = getSource().observable$.subscribe((value) => {
				latestValue = value;
				emittedRun = thisRun;
				settleFirstEmission(value);
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

	/**
	 * The value the running source produced, or `undefined` when no subscriber
	 * holds the source once this commit's layout effects ran, when the source is
	 * released before its first emission, or when `signal` fires first.
	 */
	const whenLive = async (signal?: AbortSignal): Promise<T | undefined> => {
		if (!subscription) await afterThisCommitsLayoutEffects();
		if (!subscription || signal?.aborted) return undefined;
		if (emittedRun === run) return latestValue;
		return new Promise((resolve) => {
			const settle = (value: T | undefined) => {
				firstEmissionWaiters.delete(settle);
				signal?.removeEventListener("abort", onAbort);
				resolve(value);
			};
			const onAbort = () => settle(undefined);
			signal?.addEventListener("abort", onAbort, { once: true });
			firstEmissionWaiters.add(settle);
		});
	};

	return { getSnapshot, getServerSnapshot, subscribe, whenLive };
};
