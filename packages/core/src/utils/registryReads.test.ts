import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRegistryReads$ } from "./registryReads";

const setReadyState = (value: DocumentReadyState) =>
	Object.defineProperty(document, "readyState", {
		value,
		configurable: true,
	});

const record = () => {
	const start = Date.now();
	const reads: number[] = [];
	let completedAt: number | undefined;
	const subscription = createRegistryReads$().subscribe({
		next: () => reads.push(Date.now() - start),
		complete: () => {
			completedAt = Date.now() - start;
		},
	});
	return { reads, completedAt: () => completedAt, subscription };
};

const fireLoad = () => {
	setReadyState("complete");
	window.dispatchEvent(new Event("load"));
};

describe("createRegistryReads$", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		Reflect.deleteProperty(document, "readyState");
	});

	it("reads at subscribe and 100, 300, 600 and 1100 ms later, then completes, when subscribed after load", () => {
		setReadyState("complete");
		const { reads, completedAt } = record();
		expect(reads).toEqual([0]);

		vi.advanceTimersByTime(60_000);

		expect(reads).toEqual([0, 100, 300, 600, 1100]);
		expect(completedAt()).toBe(1100);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("reads on the subscribe tail, then on the same tail from load, and completes 1100 ms after load", () => {
		setReadyState("interactive");
		const { reads, completedAt } = record();

		vi.advanceTimersByTime(2000);
		expect(reads).toEqual([0, 100, 300, 600, 1100]);
		expect(completedAt()).toBeUndefined();

		fireLoad();
		vi.advanceTimersByTime(60_000);

		expect(reads).toEqual([
			0, 100, 300, 600, 1100, 2000, 2100, 2300, 2600, 3100,
		]);
		expect(completedAt()).toBe(3100);
	});

	it("restarts the tail at load, dropping the subscribe reads still pending", () => {
		setReadyState("interactive");
		const { reads, completedAt } = record();

		vi.advanceTimersByTime(250);
		fireLoad();
		vi.advanceTimersByTime(60_000);

		expect(reads).toEqual([0, 100, 250, 350, 550, 850, 1350]);
		expect(completedAt()).toBe(1350);
	});

	it("cancels its pending reads on unsubscribe", () => {
		setReadyState("complete");
		const { reads, subscription } = record();

		vi.advanceTimersByTime(150);
		subscription.unsubscribe();
		vi.advanceTimersByTime(60_000);

		expect(reads).toEqual([0, 100]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("reads once at subscribe, never completes and sets no timer on the server", () => {
		vi.stubGlobal("window", undefined);
		const { reads, completedAt } = record();

		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(60_000);

		expect(reads).toEqual([0]);
		expect(completedAt()).toBeUndefined();
	});
});
