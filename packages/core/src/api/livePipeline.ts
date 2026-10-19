import { Observable } from "rxjs";

export type PipelineEnd = "aborted" | "unheld" | "errored" | "completed";

/** The running pipeline's state, or why it cannot serve an action. */
export type Liveness<T> = { state: T; end?: undefined } | { end: PipelineEnd };

export type LivePipeline<T extends {}> = {
	/** Subscribing holds the pipeline; it runs while at least one holder stays. */
	observable$: Observable<T>;
	/**
	 * The first value `pick` returns for the current run's states: its latest
	 * value, then each later emission, until `pick` returns something other
	 * than `undefined`. Never starts or holds the pipeline. Ends `unheld` while
	 * nothing holds it or once the last holder leaves, `errored` or
	 * `completed` once the run ended that way, and `aborted` when `signal`
	 * fires first.
	 */
	whenState: <R extends {}>(
		pick: (state: T) => R | undefined,
		signal?: AbortSignal,
	) => Promise<Liveness<R>>;
	/**
	 * The current run's state: its latest value, or its first emission once it
	 * arrives. Ends as `whenState` does.
	 */
	whenLive: (signal?: AbortSignal) => Promise<Liveness<T>>;
};

export const createLivePipeline = <T extends {}>(
	source$: Observable<T>,
): LivePipeline<T> => {
	let holders = 0;
	let run = 0;
	let emittedRun = 0;
	let latestValue: T | undefined;
	let ended: PipelineEnd | undefined;
	const waiters = new Set<(liveness: Liveness<T>) => void>();

	const notifyWaiters = (liveness: Liveness<T>) => {
		for (const waiter of waiters) waiter(liveness);
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
				notifyWaiters({ state: value });
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
			if (--holders === 0) notifyWaiters({ end: ended ?? "unheld" });
		};
	});

	const whenState = async <R extends {}>(
		pick: (state: T) => R | undefined,
		signal?: AbortSignal,
	): Promise<Liveness<R>> => {
		if (signal?.aborted) return { end: "aborted" };
		if (ended) return { end: ended };
		if (holders === 0) return { end: "unheld" };
		const current = emittedRun === run ? pick(latestValue as T) : undefined;
		if (current !== undefined) return { state: current };
		return new Promise((resolve) => {
			const settle = (liveness: Liveness<R>) => {
				waiters.delete(observe);
				signal?.removeEventListener("abort", onAbort);
				resolve(liveness);
			};
			const observe = (liveness: Liveness<T>) => {
				if (liveness.end) return settle({ end: liveness.end });
				const picked = pick(liveness.state);
				if (picked !== undefined) settle({ state: picked });
			};
			const onAbort = () => settle({ end: "aborted" });
			signal?.addEventListener("abort", onAbort, { once: true });
			waiters.add(observe);
		});
	};

	const whenLive = (signal?: AbortSignal) =>
		whenState((state) => state, signal);

	return { observable$, whenState, whenLive };
};
