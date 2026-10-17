import { BehaviorSubject, Observable, Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { createExternalStore } from "./createExternalStore";

const storeOf = <T>(
	observable$: Observable<T>,
	initialValue: T,
	serverValue = initialValue,
) => createExternalStore(() => ({ observable$, initialValue }), serverValue);

const countingSubscriptions = <T>(subject: Subject<T>) => {
	let count = 0;
	const observable$ = new Observable<T>((subscriber) => {
		count++;
		return subject.subscribe(subscriber);
	});
	return { observable$, subscriptions: () => count };
};

const flushMicrotasks = () => Promise.resolve();

describe("createExternalStore (React)", () => {
	describe("source resolution", () => {
		it("resolves the source only when a client path reads it", () => {
			const resolveSource = vi.fn(() => ({
				observable$: new Subject<{ side: string }>(),
				initialValue: { side: "client" },
			}));
			const store = createExternalStore(resolveSource, { side: "server" });

			expect(store.getServerSnapshot()).toEqual({ side: "server" });
			expect(resolveSource).toHaveBeenCalledTimes(0);

			expect(store.getSnapshot()).toEqual({ side: "client" });
			expect(resolveSource).toHaveBeenCalledTimes(1);
		});

		it("resolves the source once across snapshots and subscriptions", () => {
			const resolveSource = vi.fn(() => ({
				observable$: new BehaviorSubject({ count: 1 }).asObservable(),
				initialValue: { count: 0 },
			}));
			const store = createExternalStore(resolveSource, { count: 0 });

			store.getSnapshot();
			store.subscribe(() => {});
			store.subscribe(() => {});

			expect(store.getSnapshot()).toEqual({ count: 1 });
			expect(resolveSource).toHaveBeenCalledTimes(1);
		});
	});

	describe("getSnapshot", () => {
		it("returns the initial value before any emission", () => {
			const store = storeOf(new Subject<{ value: number }>(), { value: 42 });

			expect(store.getSnapshot()).toEqual({ value: 42 });
		});

		it("returns the latest emitted value while subscribed", () => {
			const subject = new BehaviorSubject({ count: 0 });
			const store = storeOf(subject.asObservable(), { count: 0 });
			store.subscribe(() => {});

			subject.next({ count: 10 });
			expect(store.getSnapshot()).toEqual({ count: 10 });

			subject.next({ count: 20 });
			expect(store.getSnapshot()).toEqual({ count: 20 });
		});
	});

	describe("getServerSnapshot", () => {
		it("returns the server value, unchanged by emissions", () => {
			const subject = new BehaviorSubject({ count: 0 });
			const store = storeOf(
				subject.asObservable(),
				{ count: 0 },
				{ count: 999 },
			);
			store.subscribe(() => {});

			subject.next({ count: 100 });

			expect(store.getServerSnapshot()).toEqual({ count: 999 });
			expect(store.getSnapshot()).toEqual({ count: 100 });
		});
	});

	describe("subscribe", () => {
		it("calls the listener with the current value", () => {
			const store = storeOf(new BehaviorSubject({ value: 1 }), { value: 0 });

			const listener = vi.fn();
			store.subscribe(listener);

			expect(listener.mock.calls).toEqual([[{ value: 1 }]]);
		});

		it("calls the listener on each emission until it unsubscribes", () => {
			const subject = new BehaviorSubject({ value: 0 });
			const store = storeOf(subject.asObservable(), { value: 0 });

			const listener = vi.fn();
			const unsubscribe = store.subscribe(listener);
			subject.next({ value: 1 });
			unsubscribe();
			subject.next({ value: 2 });

			expect(listener.mock.calls).toEqual([[{ value: 0 }], [{ value: 1 }]]);
		});

		it("keeps notifying the remaining listener when another leaves", async () => {
			const subject = new BehaviorSubject({ count: 0 });
			const store = storeOf(subject.asObservable(), { count: 0 });

			const leaving = vi.fn();
			const staying = vi.fn();
			const unsubscribe = store.subscribe(leaving);
			store.subscribe(staying);
			unsubscribe();
			await flushMicrotasks();
			subject.next({ count: 5 });

			expect(leaving.mock.calls).toEqual([[{ count: 0 }]]);
			expect(staying.mock.calls).toEqual([[{ count: 0 }], [{ count: 5 }]]);
		});
	});

	describe("source lifetime", () => {
		it("releases the source a microtask after the last listener leaves", async () => {
			const subject = new Subject<{ value: number }>();
			const store = storeOf(subject.asObservable(), { value: 0 });

			const unsubscribe = store.subscribe(() => {});
			unsubscribe();
			expect(subject.observed).toBe(true);

			await flushMicrotasks();
			expect(subject.observed).toBe(false);
		});

		it("keeps one source subscription across a StrictMode unsubscribe and resubscribe", async () => {
			const subject = new BehaviorSubject({ value: 0 });
			const { observable$, subscriptions } = countingSubscriptions(subject);
			const store = storeOf(observable$, { value: 0 });

			store.subscribe(() => {})();
			const listener = vi.fn();
			store.subscribe(listener);
			await flushMicrotasks();
			subject.next({ value: 100 });

			expect(subscriptions()).toBe(1);
			expect(listener).toHaveBeenLastCalledWith({ value: 100 });
		});

		it("subscribes the source again after a release", async () => {
			const subject = new BehaviorSubject({ status: "pending" });
			const { observable$, subscriptions } = countingSubscriptions(subject);
			const store = storeOf(observable$, { status: "pending" });

			store.subscribe(() => {})();
			await flushMicrotasks();
			const listener = vi.fn();
			store.subscribe(listener);
			subject.next({ status: "complete" });

			expect(subscriptions()).toBe(2);
			expect(store.getSnapshot()).toEqual({ status: "complete" });
			expect(listener).toHaveBeenLastCalledWith({ status: "complete" });
		});
	});
});
