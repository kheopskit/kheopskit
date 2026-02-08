import { BehaviorSubject, Subject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "./createStore";

describe("createStore (React)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("initialization", () => {
		it("returns store with required methods", () => {
			const subject = new BehaviorSubject({ count: 0 });
			const store = createStore(subject.asObservable(), { count: 0 });

			expect(store.getSnapshot).toBeDefined();
			expect(store.getServerSnapshot).toBeDefined();
			expect(store.subscribe).toBeDefined();
			expect(store.destroy).toBeDefined();
		});

		it("getSnapshot returns initial value before any emission", () => {
			const subject = new Subject<{ value: number }>();
			const initialValue = { value: 42 };
			const store = createStore(subject.asObservable(), initialValue);

			expect(store.getSnapshot()).toEqual(initialValue);
		});
	});

	describe("getSnapshot", () => {
		it("returns latest emitted value", () => {
			const subject = new BehaviorSubject({ count: 0 });
			const store = createStore(subject.asObservable(), { count: 0 });

			subject.next({ count: 10 });
			expect(store.getSnapshot()).toEqual({ count: 10 });

			subject.next({ count: 20 });
			expect(store.getSnapshot()).toEqual({ count: 20 });
		});

		it("returns same reference for unchanged value", () => {
			const subject = new BehaviorSubject({ count: 0 });
			const store = createStore(subject.asObservable(), { count: 0 });

			subject.next({ count: 5 });
			const snapshot1 = store.getSnapshot();
			const snapshot2 = store.getSnapshot();

			expect(snapshot1).toBe(snapshot2);
		});
	});

	describe("getServerSnapshot", () => {
		it("returns initialValue when no serverValue provided", () => {
			const subject = new BehaviorSubject({ data: "client" });
			const initialValue = { data: "initial" };
			const store = createStore(subject.asObservable(), initialValue);

			expect(store.getServerSnapshot()).toEqual(initialValue);
		});

		it("returns serverValue when provided", () => {
			const subject = new BehaviorSubject({ data: "client" });
			const initialValue = { data: "initial" };
			const serverValue = { data: "server" };
			const store = createStore(
				subject.asObservable(),
				initialValue,
				serverValue,
			);

			expect(store.getServerSnapshot()).toEqual(serverValue);
		});

		it("getServerSnapshot is stable (does not change with emissions)", () => {
			const subject = new BehaviorSubject({ count: 0 });
			const serverValue = { count: 999 };
			const store = createStore(
				subject.asObservable(),
				{ count: 0 },
				serverValue,
			);

			subject.next({ count: 100 });
			expect(store.getServerSnapshot()).toEqual(serverValue);

			subject.next({ count: 200 });
			expect(store.getServerSnapshot()).toEqual(serverValue);
		});
	});

	describe("subscribe", () => {
		it("calls callback with initial value", () => {
			const subject = new BehaviorSubject({ value: 1 });
			const store = createStore(subject.asObservable(), { value: 1 });

			const callback = vi.fn();
			const unsubscribe = store.subscribe(callback);

			expect(callback).toHaveBeenCalledTimes(1);
			expect(callback).toHaveBeenCalledWith({ value: 1 });

			unsubscribe();
		});

		it("calls callback on each emission", () => {
			const subject = new BehaviorSubject({ value: 0 });
			const store = createStore(subject.asObservable(), { value: 0 });

			const callback = vi.fn();
			const unsubscribe = store.subscribe(callback);

			subject.next({ value: 1 });
			subject.next({ value: 2 });
			subject.next({ value: 3 });

			expect(callback).toHaveBeenCalledTimes(4); // initial + 3 emissions
			expect(callback).toHaveBeenLastCalledWith({ value: 3 });

			unsubscribe();
		});

		it("unsubscribe stops callbacks", () => {
			const subject = new BehaviorSubject({ value: 0 });
			const store = createStore(subject.asObservable(), { value: 0 });

			const callback = vi.fn();
			const unsubscribe = store.subscribe(callback);

			subject.next({ value: 1 });
			expect(callback).toHaveBeenCalledTimes(2);

			unsubscribe();

			subject.next({ value: 2 });
			subject.next({ value: 3 });
			expect(callback).toHaveBeenCalledTimes(2); // No more calls
		});

		it("multiple subscribers work independently", () => {
			const subject = new BehaviorSubject({ count: 0 });
			const store = createStore(subject.asObservable(), { count: 0 });

			const callback1 = vi.fn();
			const callback2 = vi.fn();

			const unsub1 = store.subscribe(callback1);
			const unsub2 = store.subscribe(callback2);

			subject.next({ count: 5 });

			expect(callback1).toHaveBeenCalledTimes(2);
			expect(callback2).toHaveBeenCalledTimes(2);

			unsub1();

			subject.next({ count: 10 });

			expect(callback1).toHaveBeenCalledTimes(2); // stopped
			expect(callback2).toHaveBeenCalledTimes(3); // still receiving

			unsub2();
		});
	});

	describe("destroy", () => {
		it("stops receiving updates from observable", () => {
			const subject = new BehaviorSubject({ value: 0 });
			const store = createStore(subject.asObservable(), { value: 0 });

			store.destroy();

			subject.next({ value: 100 });

			// getSnapshot will still return the last value before destroy
			expect(store.getSnapshot()).toEqual({ value: 0 });
		});
	});

	describe("React StrictMode compatibility", () => {
		it("reconnects observable after destroy when resubscribed", () => {
			// React StrictMode mounts → unmounts → remounts components
			// This test simulates that pattern
			const subject = new BehaviorSubject({ value: 0 });
			const store = createStore(subject.asObservable(), { value: 0 });

			// First mount: subscribe
			const callback1 = vi.fn();
			const unsub1 = store.subscribe(callback1);
			expect(callback1).toHaveBeenCalledWith({ value: 0 });

			// StrictMode unmount: destroy is called
			unsub1();
			store.destroy();

			// StrictMode remount: subscribe again
			const callback2 = vi.fn();
			const unsub2 = store.subscribe(callback2);
			expect(callback2).toHaveBeenCalledWith({ value: 0 });

			// Now emit new value - should reach the second subscriber
			subject.next({ value: 100 });

			expect(callback2).toHaveBeenCalledWith({ value: 100 });
			expect(store.getSnapshot()).toEqual({ value: 100 });

			unsub2();
		});

		it("continues working after multiple destroy/resubscribe cycles", () => {
			const subject = new BehaviorSubject({ count: 0 });
			const store = createStore(subject.asObservable(), { count: 0 });

			// Cycle 1
			const cb1 = vi.fn();
			store.subscribe(cb1)();
			store.destroy();

			// Cycle 2
			const cb2 = vi.fn();
			store.subscribe(cb2)();
			store.destroy();

			// Cycle 3 - should still work
			const cb3 = vi.fn();
			const unsub3 = store.subscribe(cb3);

			subject.next({ count: 42 });

			expect(cb3).toHaveBeenCalledWith({ count: 42 });
			expect(store.getSnapshot()).toEqual({ count: 42 });

			unsub3();
		});

		it("does not disconnect while subscribers exist", () => {
			const subject = new BehaviorSubject({ data: "initial" });
			const store = createStore(subject.asObservable(), { data: "initial" });

			const callback = vi.fn();
			const unsub = store.subscribe(callback);

			// Calling destroy while subscribed should not break things
			store.destroy();

			// New emissions should still work because we have an active subscriber
			subject.next({ data: "updated" });

			expect(callback).toHaveBeenCalledWith({ data: "updated" });
			expect(store.getSnapshot()).toEqual({ data: "updated" });

			unsub();
		});

		it("getSnapshot returns updated value after reconnection", () => {
			const subject = new BehaviorSubject({ status: "pending" });
			const store = createStore(subject.asObservable(), { status: "pending" });

			// Simulate StrictMode: subscribe, unsubscribe, destroy
			store.subscribe(() => {})();
			store.destroy();

			// Resubscribe
			const callback = vi.fn();
			const unsub = store.subscribe(callback);

			// Emit new value
			subject.next({ status: "complete" });

			// getSnapshot should reflect the new value
			expect(store.getSnapshot()).toEqual({ status: "complete" });

			unsub();
		});
	});

	describe("SSR scenarios", () => {
		it("server: getServerSnapshot provides consistent value for hydration", () => {
			const serverData = { wallets: [], accounts: [], config: {} };
			const subject = new BehaviorSubject(serverData);
			const store = createStore(subject.asObservable(), serverData, serverData);

			// On server, getServerSnapshot is called
			expect(store.getServerSnapshot()).toEqual(serverData);
		});

		it("client hydration: getSnapshot may differ from getServerSnapshot", () => {
			const serverData = { wallets: [], accounts: [] };
			const clientData = { wallets: ["wallet1"], accounts: ["account1"] };

			const subject = new BehaviorSubject(clientData);
			const store = createStore(subject.asObservable(), serverData, serverData);

			// Server returns stable value
			expect(store.getServerSnapshot()).toEqual(serverData);

			// Client has updated value
			expect(store.getSnapshot()).toEqual(clientData);
		});
	});
});
