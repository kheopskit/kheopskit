import { type Observable, of } from "rxjs";
import { describe, expect, it } from "vitest";
import { getCachedObservable$ } from "./getCachedObservable";

// Access the module's private cache by re-importing between tests
// Since we can't clear the cache, we'll use unique keys for each test

describe("getCachedObservable$", () => {
	describe("caching behavior", () => {
		it("returns the same observable instance for the same key", () => {
			const key = "test-same-key-1";
			let callCount = 0;

			const factory = () => {
				callCount++;
				return of("value");
			};

			const obs1 = getCachedObservable$(key, factory);
			const obs2 = getCachedObservable$(key, factory);

			expect(obs1).toBe(obs2);
			expect(callCount).toBe(1); // Factory called only once
		});

		it("creates different observables for different keys", () => {
			const key1 = "test-diff-key-1";
			const key2 = "test-diff-key-2";

			const obs1 = getCachedObservable$(key1, () => of("value1"));
			const obs2 = getCachedObservable$(key2, () => of("value2"));

			expect(obs1).not.toBe(obs2);
		});

		it("factory is called only once per key", () => {
			const key = "test-factory-once-1";
			let createCount = 0;

			const factory = () => {
				createCount++;
				return of(createCount);
			};

			getCachedObservable$(key, factory);
			getCachedObservable$(key, factory);
			getCachedObservable$(key, factory);

			expect(createCount).toBe(1);
		});
	});

	describe("observable behavior", () => {
		it("returns working observable that emits values", async () => {
			const key = "test-emit-values-1";
			const obs = getCachedObservable$(key, () => of("test-value"));

			const values: string[] = [];
			obs.subscribe((value) => values.push(value));

			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(values).toEqual(["test-value"]);
		});

		it("cached observable can be subscribed multiple times", async () => {
			const key = "test-multi-subscribe-1";
			const obs = getCachedObservable$(key, () => of(42));

			const results: number[] = [];

			obs.subscribe((v) => results.push(v));
			obs.subscribe((v) => results.push(v));

			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(results).toEqual([42, 42]);
		});
	});

	describe("type inference", () => {
		it("correctly infers observable type", () => {
			const key = "test-type-inference-1";
			const obs: Observable<{ foo: string }> = getCachedObservable$(key, () =>
				of({ foo: "bar" }),
			);

			expect(obs).toBeDefined();
		});

		it("allows custom observable types", () => {
			const key = "test-custom-type-1";
			const customObs = { custom: true, subscribe: () => {} };

			const result = getCachedObservable$(key, () => customObs);
			expect(result).toBe(customObs);
		});
	});
});
