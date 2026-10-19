import { Observable } from "rxjs";

export type PipelineEnd = "aborted" | "unheld" | "errored" | "completed";

/** The running pipeline's state, or why it cannot serve an action. */
export type Liveness<T> = { state: T; end?: undefined } | { end: PipelineEnd };

export type LivePipeline<T> = {
	/** Subscribing holds the pipeline; it runs while at least one holder stays. */
	observable$: Observable<T>;
	/**
	 * The current run's state: its latest value, or its first emission once it
	 * arrives. Ends `unheld` while nothing holds the pipeline, without starting
	 * it, `errored` or `completed` once the run ended that way, and `aborted`
	 * when `signal` fires first.
	 */
	whenLive: (signal?: AbortSignal) => Promise<Liveness<T>>;
};

export const createLivePipeline = <T>(
	source$: Observable<T>,
): LivePipeline<T> => {
	let holders = 0;
	let run = 0;
	let emittedRun = 0;
	let latestValue: T | undefined;
	let ended: PipelineEnd | undefined;
	const firstEmissionWaiters = new Set<(liveness: Liveness<T>) => void>();

	const settleFirstEmission = (liveness: Liveness<T>) => {
		for (const waiter of firstEmissionWaiters) waiter(liveness);
	};

	const observable$ = new Observable<T>((subscriber) => {
		if (holders++ === 0) {
			run++;
			ended = undefined;
		}
		const thisRun = run;
		const subscription = source$.subscribe({
			next: (value) => {
				latestValue = value;
				emittedRun = thisRun;
				settleFirstEmission({ state: value });
				subscriber.next(value);
			},
			error: (error) => {
				ended = "errored";
				subscriber.error(error);
			},
			complete: () => {
				ended = "completed";
				subscriber.complete();
			},
		});
		return () => {
			subscription.unsubscribe();
			if (--holders === 0) settleFirstEmission({ end: ended ?? "unheld" });
		};
	});

	const whenLive = async (signal?: AbortSignal): Promise<Liveness<T>> => {
		if (signal?.aborted) return { end: "aborted" };
		if (ended) return { end: ended };
		if (holders === 0) return { end: "unheld" };
		if (emittedRun === run) return { state: latestValue as T };
		return new Promise((resolve) => {
			const settle = (liveness: Liveness<T>) => {
				firstEmissionWaiters.delete(settle);
				signal?.removeEventListener("abort", onAbort);
				resolve(liveness);
			};
			const onAbort = () => settle({ end: "aborted" });
			signal?.addEventListener("abort", onAbort, { once: true });
			firstEmissionWaiters.add(settle);
		});
	};

	return { observable$, whenLive };
};
