import type { Subscription } from "rxjs";
import type { Liveness, LivePipeline } from "./livePipeline";

export type ExternalStoreSource<T> = {
	pipeline: LivePipeline<T>;
	initialValue: T;
};

// React runs every layout setup of a commit synchronously, so once this
// microtask runs a mounted provider has taken its hold on the pipeline, and a
// release queued by a hide in this task has landed.
const afterThisCommitsLayoutEffects = () => Promise.resolve();

export const createExternalStore = <T>(
	resolveClientSource: () => ExternalStoreSource<T>,
	serverValue: T,
) => {
	let source: ExternalStoreSource<T> | undefined;
	let latestValue: T | undefined;
	let subscription: Subscription | undefined;
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
			subscription = getSource().pipeline.observable$.subscribe((value) => {
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

	/** The shared pipeline's liveness once this commit's layout effects ran. */
	const whenLive = async (signal?: AbortSignal): Promise<Liveness<T>> => {
		await afterThisCommitsLayoutEffects();
		return getSource().pipeline.whenLive(signal);
	};

	return { getSnapshot, getServerSnapshot, subscribe, whenLive };
};
