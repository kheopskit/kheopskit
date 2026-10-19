import { BehaviorSubject, Observable, Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { createLivePipeline, type Liveness } from "./livePipeline";

const flushMicrotasks = () => Promise.resolve();

const outcome = async (promise: Promise<Liveness<unknown>>) => {
	let settled: Liveness<unknown> | "pending" = "pending";
	promise.then((liveness) => {
		settled = liveness;
	});
	for (let i = 0; i < 5; i++) await flushMicrotasks();
	return settled;
};

describe("createLivePipeline", () => {
	it("forwards the source's values to every holder", () => {
		const subject = new Subject<number>();
		const { observable$ } = createLivePipeline(subject);
		const first = vi.fn();
		const second = vi.fn();
		observable$.subscribe(first);
		observable$.subscribe(second);
		subject.next(1);
		subject.next(2);

		expect({ first: first.mock.calls, second: second.mock.calls }).toEqual({
			first: [[1], [2]],
			second: [[1], [2]],
		});
	});

	it("serves the running pipeline's latest value", async () => {
		const subject = new BehaviorSubject(1);
		const pipeline = createLivePipeline(subject);
		pipeline.observable$.subscribe();
		subject.next(2);

		expect(await pipeline.whenLive()).toEqual({ state: 2 });
	});

	it("stays live while one of two holders leaves", async () => {
		const subject = new BehaviorSubject(1);
		const pipeline = createLivePipeline(subject);
		const leaving = pipeline.observable$.subscribe();
		pipeline.observable$.subscribe();
		leaving.unsubscribe();

		expect({
			liveness: await pipeline.whenLive(),
			observed: subject.observed,
		}).toEqual({ liveness: { state: 1 }, observed: true });
	});

	it("ends unheld while nothing holds the pipeline, without starting it", async () => {
		const subject = new BehaviorSubject(1);
		const pipeline = createLivePipeline(subject);
		pipeline.observable$.subscribe().unsubscribe();

		expect({
			liveness: await pipeline.whenLive(),
			observed: subject.observed,
		}).toEqual({ liveness: { end: "unheld" }, observed: false });
	});

	it("waits for a restarted pipeline's first emission instead of serving the stopped run's value", async () => {
		const subject = new Subject<number>();
		const pipeline = createLivePipeline(subject);
		const firstRun = pipeline.observable$.subscribe();
		subject.next(1);
		firstRun.unsubscribe();
		pipeline.observable$.subscribe();
		const live = pipeline.whenLive();
		const beforeEmission = await outcome(live);
		subject.next(2);

		expect({ beforeEmission, live: await live }).toEqual({
			beforeEmission: "pending",
			live: { state: 2 },
		});
	});

	it("ends unheld when the last holder leaves before the first emission", async () => {
		const subject = new Subject<number>();
		const pipeline = createLivePipeline(subject);
		const holder = pipeline.observable$.subscribe();
		const live = pipeline.whenLive();
		holder.unsubscribe();

		expect(await outcome(live)).toEqual({ end: "unheld" });
	});

	it("ends aborted when the signal fires while waiting, and at once when it already fired", async () => {
		const subject = new Subject<number>();
		const pipeline = createLivePipeline(subject);
		pipeline.observable$.subscribe();
		const controller = new AbortController();
		const waiting = pipeline.whenLive(controller.signal);
		controller.abort();
		subject.next(1);

		expect({
			waiting: await outcome(waiting),
			alreadyAborted: await pipeline.whenLive(controller.signal),
		}).toEqual({
			waiting: { end: "aborted" },
			alreadyAborted: { end: "aborted" },
		});
	});

	it.each([
		[
			"errors",
			(subject: Subject<number>) => subject.error(new Error("boom")),
			"errored",
		],
		[
			"completes",
			(subject: Subject<number>) => subject.complete(),
			"completed",
		],
	])(
		"settles a pending wait and later calls when the source %s before its first emission",
		async (_, finish, end) => {
			const subject = new Subject<number>();
			const pipeline = createLivePipeline(subject);
			const holder = vi.fn();
			pipeline.observable$.subscribe({
				next: holder,
				error: holder,
				complete: holder,
			});
			const waiting = pipeline.whenLive();
			finish(subject);

			expect({
				waiting: await outcome(waiting),
				later: await outcome(pipeline.whenLive()),
				holderNotified: holder.mock.calls.length,
			}).toEqual({ waiting: { end }, later: { end }, holderNotified: 1 });
		},
	);

	it("starts a new run for the next holder after the source errored", async () => {
		let attempts = 0;
		const pipeline = createLivePipeline(
			new Observable<number>((subscriber) => {
				if (++attempts === 1) subscriber.error(new Error("boom"));
				else subscriber.next(7);
			}),
		);
		pipeline.observable$.subscribe({ error: () => {} });
		const afterError = await pipeline.whenLive();
		pipeline.observable$.subscribe();

		expect({ afterError, restarted: await pipeline.whenLive() }).toEqual({
			afterError: { end: "errored" },
			restarted: { state: 7 },
		});
	});
});
