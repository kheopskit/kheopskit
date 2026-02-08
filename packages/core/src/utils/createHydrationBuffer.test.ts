import { BehaviorSubject, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createAccountHydrationBuffer,
	createHydrationBuffer,
} from "./createHydrationBuffer";

describe("createHydrationBuffer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("when no grace period", () => {
		it("returns live items immediately with isHydrating false", () => {
			const liveItems$ = new BehaviorSubject([{ id: "a" }]);
			const result$ = createHydrationBuffer(
				[{ id: "cached" }],
				liveItems$,
				0, // no grace period
				(item) => item.id,
			);

			const results: unknown[] = [];
			result$.subscribe((r) => results.push(r));

			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				items: [{ id: "a" }],
				isHydrating: false,
			});
		});
	});

	describe("when no cached items", () => {
		it("returns live items with isHydrating false", () => {
			const liveItems$ = new BehaviorSubject([{ id: "a" }]);
			const result$ = createHydrationBuffer(
				[], // no cached items
				liveItems$,
				500,
				(item) => item.id,
			);

			const results: unknown[] = [];
			result$.subscribe((r) => results.push(r));

			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				items: [{ id: "a" }],
				isHydrating: false,
			});
		});
	});

	describe("with cached items and grace period", () => {
		it("emits cached items immediately before live items arrive", () => {
			const liveItems$ = new Subject<{ id: string }[]>();
			const cached = [{ id: "cached1" }, { id: "cached2" }];

			const result$ = createHydrationBuffer(
				cached,
				liveItems$,
				500,
				(i) => i.id,
			);

			const results: unknown[] = [];
			result$.subscribe((r) => results.push(r));

			// Should emit cached items immediately (via startWith([]))
			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				items: [{ id: "cached1" }, { id: "cached2" }],
				isHydrating: true,
			});
		});

		it("merges live items with cached, live takes precedence", () => {
			const liveItems$ = new Subject<{ id: string }[]>();
			const cached = [{ id: "a" }, { id: "b" }];

			const result$ = createHydrationBuffer(
				cached,
				liveItems$,
				500,
				(i) => i.id,
			);

			const results: unknown[] = [];
			result$.subscribe((r) => results.push(r));

			// Emit live item that matches cached "a"
			liveItems$.next([{ id: "a" }]);

			expect(results).toHaveLength(2);
			// Should have live "a" + cached "b" (not yet appeared in live)
			expect(results[1]).toEqual({
				items: [{ id: "a" }, { id: "b" }],
				isHydrating: true,
			});
		});

		it("removes cached items after grace period expires", () => {
			const liveItems$ = new BehaviorSubject([{ id: "a" }]);
			const cached = [{ id: "a" }, { id: "b" }];

			const result$ = createHydrationBuffer(
				cached,
				liveItems$,
				500,
				(i) => i.id,
			);

			const results: unknown[] = [];
			result$.subscribe((r) => results.push(r));

			// Before timeout - should have merged items
			expect(results[results.length - 1]).toEqual({
				items: [{ id: "a" }, { id: "b" }],
				isHydrating: true,
			});

			// Advance timers past grace period
			vi.advanceTimersByTime(600);

			// After timeout - should only have live items
			expect(results[results.length - 1]).toEqual({
				items: [{ id: "a" }],
				isHydrating: false,
			});
		});

		it("continues to emit live updates after grace period expires", () => {
			const liveItems$ = new BehaviorSubject([{ id: "a" }]);
			const cached = [{ id: "a" }, { id: "b" }];

			const result$ = createHydrationBuffer(
				cached,
				liveItems$,
				500,
				(i) => i.id,
			);

			const results: unknown[] = [];
			result$.subscribe((r) => results.push(r));

			// Advance timers past grace period
			vi.advanceTimersByTime(600);

			const initialCount = results.length;

			// Push new live items after grace period
			liveItems$.next([{ id: "a" }, { id: "c" }, { id: "d" }]);

			// Should receive the update
			expect(results.length).toBeGreaterThan(initialCount);
			expect(results[results.length - 1]).toEqual({
				items: [{ id: "a" }, { id: "c" }, { id: "d" }],
				isHydrating: false,
			});
		});

		it("remains subscribed indefinitely after grace period", () => {
			const liveItems$ = new BehaviorSubject([{ id: "a" }]);
			const cached = [{ id: "cached" }];

			const result$ = createHydrationBuffer(
				cached,
				liveItems$,
				100,
				(i) => i.id,
			);

			const results: unknown[] = [];
			result$.subscribe((r) => results.push(r));

			// Advance past grace period
			vi.advanceTimersByTime(150);

			// Wait a long time - should still be subscribed
			vi.advanceTimersByTime(10000);

			const countAfterLongWait = results.length;

			// Push new update
			liveItems$.next([{ id: "new" }]);

			// Should still receive updates
			expect(results.length).toBe(countAfterLongWait + 1);
			expect(results[results.length - 1]).toEqual({
				items: [{ id: "new" }],
				isHydrating: false,
			});
		});
	});
});

describe("createAccountHydrationBuffer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("keeps cached accounts from wallets that haven't provided accounts yet", () => {
		const liveAccounts$ = new BehaviorSubject([
			{ id: "acc1", walletId: "wallet1" },
		]);
		const cachedAccounts = [
			{ id: "acc1", walletId: "wallet1" },
			{ id: "acc2", walletId: "wallet2" },
		];

		const result$ = createAccountHydrationBuffer(
			cachedAccounts,
			liveAccounts$,
			500,
			(a) => a.walletId,
		);

		const results: unknown[] = [];
		result$.subscribe((r) => results.push(r));

		// wallet1 has live accounts, so its cached accounts are replaced
		// wallet2 has no live accounts, so its cached accounts are preserved
		expect(results[results.length - 1]).toEqual({
			items: [
				{ id: "acc1", walletId: "wallet1" },
				{ id: "acc2", walletId: "wallet2" },
			],
			isHydrating: true,
		});
	});

	it("removes cached accounts from wallets when they provide live accounts", () => {
		const liveAccounts$ = new BehaviorSubject<
			{ id: string; walletId: string }[]
		>([]);
		const cachedAccounts = [
			{ id: "acc1", walletId: "wallet1" },
			{ id: "acc2", walletId: "wallet2" },
		];

		const result$ = createAccountHydrationBuffer(
			cachedAccounts,
			liveAccounts$,
			500,
			(a) => a.walletId,
		);

		const results: unknown[] = [];
		result$.subscribe((r) => results.push(r));

		// Initially all cached accounts are shown
		expect(results[results.length - 1]).toEqual({
			items: [
				{ id: "acc1", walletId: "wallet1" },
				{ id: "acc2", walletId: "wallet2" },
			],
			isHydrating: true,
		});

		// wallet1 provides a different account
		liveAccounts$.next([{ id: "acc3", walletId: "wallet1" }]);

		// Now wallet1's cached account is gone, replaced by live, wallet2 cached still there
		expect(results[results.length - 1]).toEqual({
			items: [
				{ id: "acc3", walletId: "wallet1" },
				{ id: "acc2", walletId: "wallet2" },
			],
			isHydrating: true,
		});
	});

	it("only shows live accounts after grace period", () => {
		const liveAccounts$ = new BehaviorSubject([
			{ id: "acc1", walletId: "wallet1" },
		]);
		const cachedAccounts = [
			{ id: "acc1", walletId: "wallet1" },
			{ id: "acc2", walletId: "wallet2" }, // This wallet never provides accounts
		];

		const result$ = createAccountHydrationBuffer(
			cachedAccounts,
			liveAccounts$,
			500,
			(a) => a.walletId,
		);

		const results: unknown[] = [];
		result$.subscribe((r) => results.push(r));

		// Advance past grace period
		vi.advanceTimersByTime(600);

		// Only live accounts remain
		expect(results[results.length - 1]).toEqual({
			items: [{ id: "acc1", walletId: "wallet1" }],
			isHydrating: false,
		});
	});

	it("continues to emit updates after grace period expires", () => {
		const liveAccounts$ = new BehaviorSubject([
			{ id: "acc1", walletId: "wallet1" },
		]);
		const cachedAccounts = [
			{ id: "acc1", walletId: "wallet1" },
			{ id: "acc2", walletId: "wallet2" },
		];

		const result$ = createAccountHydrationBuffer(
			cachedAccounts,
			liveAccounts$,
			500,
			(a) => a.walletId,
		);

		const results: unknown[] = [];
		result$.subscribe((r) => results.push(r));

		// Advance past grace period
		vi.advanceTimersByTime(600);

		const countAfterGracePeriod = results.length;

		// Emit new accounts after grace period
		liveAccounts$.next([
			{ id: "acc1", walletId: "wallet1" },
			{ id: "acc3", walletId: "wallet1" },
		]);

		// Should have received a new emission
		expect(results.length).toBeGreaterThan(countAfterGracePeriod);
		expect(results[results.length - 1]).toEqual({
			items: [
				{ id: "acc1", walletId: "wallet1" },
				{ id: "acc3", walletId: "wallet1" },
			],
			isHydrating: false,
		});
	});
});
