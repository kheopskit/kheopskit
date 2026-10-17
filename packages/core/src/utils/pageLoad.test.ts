import { afterEach, describe, expect, it, vi } from "vitest";
import { pageLoaded$ } from "./pageLoad";

const setReadyState = (value: DocumentReadyState) =>
	Object.defineProperty(document, "readyState", {
		value,
		configurable: true,
	});

const record = () => {
	const values: boolean[] = [];
	let completed = false;
	const subscription = pageLoaded$.subscribe({
		next: (value) => values.push(value),
		complete: () => {
			completed = true;
		},
	});
	return { values, isCompleted: () => completed, subscription };
};

describe("pageLoaded$", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		Reflect.deleteProperty(document, "readyState");
	});

	it("emits true and completes when the page has already loaded", () => {
		setReadyState("complete");
		const { values, isCompleted } = record();

		expect(values).toEqual([true]);
		expect(isCompleted()).toBe(true);
	});

	it("emits false, then true once at window load", () => {
		setReadyState("interactive");
		const { values, isCompleted } = record();
		expect(values).toEqual([false]);

		window.dispatchEvent(new Event("load"));
		window.dispatchEvent(new Event("load"));

		expect(values).toEqual([false, true]);
		expect(isCompleted()).toBe(true);
	});

	it("gives each subscriber its own current state", () => {
		setReadyState("interactive");
		const early = record();
		setReadyState("complete");
		window.dispatchEvent(new Event("load"));
		const late = record();

		expect(early.values).toEqual([false, true]);
		expect(late.values).toEqual([true]);
	});

	it("removes its load listener on unsubscribe", () => {
		setReadyState("interactive");
		const addEventListener = vi.spyOn(window, "addEventListener");
		const removeEventListener = vi.spyOn(window, "removeEventListener");
		const { subscription } = record();
		const [, listener] =
			addEventListener.mock.calls.find(([type]) => type === "load") ?? [];

		subscription.unsubscribe();

		expect(listener).toBeDefined();
		expect(removeEventListener).toHaveBeenCalledWith("load", listener);
	});

	it("emits false and never completes on the server", () => {
		vi.stubGlobal("document", undefined);
		const { values, isCompleted } = record();

		expect(values).toEqual([false]);
		expect(isCompleted()).toBe(false);
	});
});
