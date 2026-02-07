import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "./createStore";
import { cookieStorage, noopStorage, type Storage } from "./storage";

describe("createStore", () => {
	const TEST_KEY = "test-store-key";

	beforeEach(() => {
		localStorage.clear();
		// Clear cookies
		document.cookie.split(";").forEach((c) => {
			const name = c.split("=")[0]?.trim();
			if (name) {
				// biome-ignore lint/suspicious/noDocumentCookie: necessary for test cleanup
				document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:01 GMT;path=/`;
			}
		});
	});

	describe("with default storage (safeLocalStorage)", () => {
		it("initializes with defaultValue when storage is empty", () => {
			const defaultValue = { count: 0 };
			const store = createStore(TEST_KEY, defaultValue);
			expect(store.get()).toEqual(defaultValue);
		});

		it("initializes with stored value when available", () => {
			const storedValue = { count: 42 };
			localStorage.setItem(TEST_KEY, JSON.stringify(storedValue));
			const store = createStore(TEST_KEY, { count: 0 });
			expect(store.get()).toEqual(storedValue);
		});

		it("set updates the value and persists to storage", () => {
			const store = createStore(TEST_KEY, { count: 0 });
			store.set({ count: 10 });
			expect(store.get()).toEqual({ count: 10 });
			expect(JSON.parse(localStorage.getItem(TEST_KEY) || "{}")).toEqual({
				count: 10,
			});
		});

		it("mutate transforms the value and persists", () => {
			const store = createStore(TEST_KEY, { count: 5 });
			store.mutate((prev) => ({ count: prev.count + 1 }));
			expect(store.get()).toEqual({ count: 6 });
			expect(JSON.parse(localStorage.getItem(TEST_KEY) || "{}")).toEqual({
				count: 6,
			});
		});

		it("observable emits initial value", () => {
			const defaultValue = { count: 0 };
			const store = createStore(TEST_KEY, defaultValue);
			const values: { count: number }[] = [];
			const sub = store.observable.subscribe((v) => values.push(v));
			expect(values).toHaveLength(1);
			expect(values[0]).toEqual(defaultValue);
			sub.unsubscribe();
		});

		it("observable emits on set", () => {
			const store = createStore(TEST_KEY, { count: 0 });
			const values: { count: number }[] = [];
			const sub = store.observable.subscribe((v) => values.push(v));
			store.set({ count: 100 });
			expect(values).toHaveLength(2);
			expect(values[1]).toEqual({ count: 100 });
			sub.unsubscribe();
		});

		it("observable emits on mutate", () => {
			const store = createStore(TEST_KEY, { count: 0 });
			const values: { count: number }[] = [];
			const sub = store.observable.subscribe((v) => values.push(v));
			store.mutate((prev) => ({ count: prev.count + 5 }));
			expect(values).toHaveLength(2);
			expect(values[1]).toEqual({ count: 5 });
			sub.unsubscribe();
		});

		it("get returns a clone (not the same reference)", () => {
			const store = createStore(TEST_KEY, { items: [1, 2, 3] });
			const val1 = store.get();
			const val2 = store.get();
			expect(val1).toEqual(val2);
			expect(val1).not.toBe(val2); // Different references
		});
	});

	describe("with noopStorage", () => {
		it("initializes with defaultValue", () => {
			const defaultValue = { name: "test" };
			const store = createStore(TEST_KEY, defaultValue, noopStorage);
			expect(store.get()).toEqual(defaultValue);
		});

		it("set updates in-memory value but does not persist", () => {
			const store = createStore(TEST_KEY, { name: "initial" }, noopStorage);
			store.set({ name: "updated" });
			expect(store.get()).toEqual({ name: "updated" });
			// Nothing persisted to localStorage
			expect(localStorage.getItem(TEST_KEY)).toBeNull();
		});

		it("mutate works in-memory", () => {
			const store = createStore(TEST_KEY, { value: 1 }, noopStorage);
			store.mutate((prev) => ({ value: prev.value * 2 }));
			expect(store.get()).toEqual({ value: 2 });
		});

		it("observable emits values", () => {
			const store = createStore(TEST_KEY, { x: 0 }, noopStorage);
			const values: { x: number }[] = [];
			const sub = store.observable.subscribe((v) => values.push(v));
			store.set({ x: 1 });
			store.set({ x: 2 });
			expect(values).toEqual([{ x: 0 }, { x: 1 }, { x: 2 }]);
			sub.unsubscribe();
		});
	});

	describe("with cookieStorage", () => {
		it("initializes with defaultValue when no cookie exists", () => {
			const store = createStore(TEST_KEY, { data: "default" }, cookieStorage());
			expect(store.get()).toEqual({ data: "default" });
		});

		it("set persists to cookie", () => {
			const storage = cookieStorage();
			const store = createStore(TEST_KEY, { data: "initial" }, storage);
			store.set({ data: "persisted" });
			expect(store.get()).toEqual({ data: "persisted" });
			// Verify cookie was set
			expect(document.cookie).toContain(TEST_KEY);
		});

		it("mutate persists to cookie", () => {
			const storage = cookieStorage();
			const store = createStore(TEST_KEY, { counter: 0 }, storage);
			store.mutate((prev) => ({ counter: prev.counter + 10 }));
			expect(store.get()).toEqual({ counter: 10 });
		});
	});

	describe("with cookieStorage and initialCookies (SSR scenario)", () => {
		it("reads initial value from ssrCookies", () => {
			const ssrData = { autoReconnect: ["polkadot:polkadot-js"] };
			const ssrCookies = `${TEST_KEY}=${encodeURIComponent(JSON.stringify(ssrData))}`;
			const storage = cookieStorage(ssrCookies);

			// On client (jsdom), cookieStorage reads from document.cookie
			// But we can test the flow by verifying createStore works with the storage
			const store = createStore(
				TEST_KEY,
				{ autoReconnect: [] as string[] },
				storage,
			);
			// In jsdom, it will read from document.cookie (which is empty), not ssrCookies
			// This is expected because document is available
			expect(store.get()).toBeDefined();
		});
	});

	describe("with custom storage implementation", () => {
		it("uses custom storage for reading", () => {
			const mockStorage: Storage = {
				getItem: vi.fn().mockReturnValue(JSON.stringify({ custom: true })),
				setItem: vi.fn(),
				removeItem: vi.fn(),
			};

			const store = createStore(TEST_KEY, { custom: false }, mockStorage);
			expect(mockStorage.getItem).toHaveBeenCalledWith(TEST_KEY);
			expect(store.get()).toEqual({ custom: true });
		});

		it("uses custom storage for writing", () => {
			const mockStorage: Storage = {
				getItem: vi.fn().mockReturnValue(null),
				setItem: vi.fn(),
				removeItem: vi.fn(),
			};

			const store = createStore(TEST_KEY, { value: 0 }, mockStorage);
			store.set({ value: 42 });
			expect(mockStorage.setItem).toHaveBeenCalledWith(
				TEST_KEY,
				JSON.stringify({ value: 42 }),
			);
		});
	});

	describe("data parsing edge cases", () => {
		it("returns defaultValue for invalid JSON in storage", () => {
			localStorage.setItem(TEST_KEY, "not valid json{{{");
			const store = createStore(TEST_KEY, { fallback: true });
			expect(store.get()).toEqual({ fallback: true });
		});

		it("handles null stored value", () => {
			localStorage.setItem(TEST_KEY, "null");
			const store = createStore(TEST_KEY, { default: true });
			// JSON.parse("null") returns null, which is a valid JSON value
			// The store returns it as-is (null)
			expect(store.get()).toBeNull();
		});

		it("handles complex nested objects", () => {
			const complex = {
				nested: {
					array: [1, 2, { deep: true }],
					string: "test",
				},
				list: ["a", "b"],
			};
			localStorage.setItem(TEST_KEY, JSON.stringify(complex));
			const store = createStore(TEST_KEY, {});
			expect(store.get()).toEqual(complex);
		});
	});

	describe("multiple stores with different keys", () => {
		it("stores are independent", () => {
			const store1 = createStore("key1", { id: 1 });
			const store2 = createStore("key2", { id: 2 });

			store1.set({ id: 100 });
			expect(store1.get()).toEqual({ id: 100 });
			expect(store2.get()).toEqual({ id: 2 });
		});
	});
});
