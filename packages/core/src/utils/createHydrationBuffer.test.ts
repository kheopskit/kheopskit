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

		it("merges live items with cached, cached takes precedence for matching keys", () => {
			const liveItems$ = new Subject<{ id: string; value?: string }[]>();
			const cached = [
				{ id: "a", value: "cached-a" },
				{ id: "b", value: "cached-b" },
			];

			const result$ = createHydrationBuffer(
				cached,
				liveItems$,
				500,
				(i) => i.id,
			);

			const results: unknown[] = [];
			result$.subscribe((r) => results.push(r));

			// Emit live item that matches cached "a"
			liveItems$.next([{ id: "a", value: "live-a" }]);

			expect(results).toHaveLength(2);
			// Should have cached "a" (preserved) + cached "b" (not yet appeared in live)
			expect(results[1]).toEqual({
				items: [
					{ id: "a", value: "cached-a" },
					{ id: "b", value: "cached-b" },
				],
				isHydrating: true,
			});
		});

		it("adds new live items not in the cache during hydration", () => {
			const liveItems$ = new Subject<{ id: string }[]>();
			const cached = [{ id: "a" }];

			const result$ = createHydrationBuffer(
				cached,
				liveItems$,
				500,
				(i) => i.id,
			);

			const results: unknown[] = [];
			result$.subscribe((r) => results.push(r));

			// Emit live items including a new one not in cache
			liveItems$.next([{ id: "a" }, { id: "c" }]);

			expect(results).toHaveLength(2);
			// "a" uses cached version, "c" is new from live
			expect(results[1]).toEqual({
				items: [{ id: "a" }, { id: "c" }],
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

	describe("with convergence check", () => {
		it("keeps hydrating after timer if convergence not met", () => {
			const liveItems$ = new BehaviorSubject([{ id: "a", isConnected: false }]);
			const cached = [{ id: "a", isConnected: true }];

			const isConverged = (
				live: { id: string; isConnected: boolean }[],
				cache: { id: string; isConnected: boolean }[],
			) => {
				const connectedIds = new Set(
					cache.filter((w) => w.isConnected).map((w) => w.id),
				);
				return [...connectedIds].every((id) =>
					live.some((w) => w.id === id && w.isConnected),
				);
			};

			const result$ = createHydrationBuffer(
				cached,
				liveItems$,
				500,
				(i) => i.id,
				isConverged,
			);

			const results: { items: unknown[]; isHydrating: boolean }[] = [];
			result$.subscribe((r) => results.push(r));

			// Advance past grace period
			vi.advanceTimersByTime(600);

			// Should STILL be hydrating (cached wallet is connected, live is not)
			expect(results[results.length - 1]?.isHydrating).toBe(true);
			// Should still use cached version (connected)
			expect(results[results.length - 1]?.items).toEqual([
				{ id: "a", isConnected: true },
			]);
		});

		it("ends hydration when convergence is met after timer", () => {
			const liveItems$ = new BehaviorSubject([{ id: "a", isConnected: false }]);
			const cached = [{ id: "a", isConnected: true }];

			const isConverged = (
				live: { id: string; isConnected: boolean }[],
				cache: { id: string; isConnected: boolean }[],
			) => {
				const connectedIds = new Set(
					cache.filter((w) => w.isConnected).map((w) => w.id),
				);
				return [...connectedIds].every((id) =>
					live.some((w) => w.id === id && w.isConnected),
				);
			};

			const result$ = createHydrationBuffer(
				cached,
				liveItems$,
				500,
				(i) => i.id,
				isConverged,
			);

			const results: { items: unknown[]; isHydrating: boolean }[] = [];
			result$.subscribe((r) => results.push(r));

			// Advance past grace period
			vi.advanceTimersByTime(600);

			// Still hydrating
			expect(results[results.length - 1]?.isHydrating).toBe(true);

			// Simulate auto-reconnect completing
			liveItems$.next([{ id: "a", isConnected: true }]);

			// Now hydration should end with live items
			expect(results[results.length - 1]?.isHydrating).toBe(false);
			expect(results[results.length - 1]?.items).toEqual([
				{ id: "a", isConnected: true },
			]);
		});

		it("forces end of hydration at max timeout even without convergence", () => {
			const liveItems$ = new BehaviorSubject([{ id: "a", isConnected: false }]);
			const cached = [{ id: "a", isConnected: true }];

			// Convergence never met (always returns false)
			const isConverged = () => false;

			const result$ = createHydrationBuffer(
				cached,
				liveItems$,
				500,
				(i) => i.id,
				isConverged,
			);

			const results: { items: unknown[]; isHydrating: boolean }[] = [];
			result$.subscribe((r) => results.push(r));

			// Advance past grace period
			vi.advanceTimersByTime(600);

			// Still hydrating
			expect(results[results.length - 1]?.isHydrating).toBe(true);

			// Advance past max timeout (6x grace period = 3000ms)
			vi.advanceTimersByTime(3000);

			// Should be forced out of hydration
			expect(results[results.length - 1]?.isHydrating).toBe(false);
			expect(results[results.length - 1]?.items).toEqual([
				{ id: "a", isConnected: false },
			]);
		});

		it("ends hydration immediately if convergence is already met when timer fires", () => {
			const liveItems$ = new BehaviorSubject([{ id: "a", isConnected: true }]);
			const cached = [{ id: "a", isConnected: true }];

			const isConverged = (
				live: { id: string; isConnected: boolean }[],
				cache: { id: string; isConnected: boolean }[],
			) => {
				const connectedIds = new Set(
					cache.filter((w) => w.isConnected).map((w) => w.id),
				);
				return [...connectedIds].every((id) =>
					live.some((w) => w.id === id && w.isConnected),
				);
			};

			const result$ = createHydrationBuffer(
				cached,
				liveItems$,
				500,
				(i) => i.id,
				isConverged,
			);

			const results: { items: unknown[]; isHydrating: boolean }[] = [];
			result$.subscribe((r) => results.push(r));

			// Before timer
			expect(results[results.length - 1]?.isHydrating).toBe(true);

			// Advance past grace period - convergence already met
			vi.advanceTimersByTime(600);

			// Should immediately end hydration
			expect(results[results.length - 1]?.isHydrating).toBe(false);
		});

		it("without convergence check, behaves like before (ends on timer)", () => {
			const liveItems$ = new BehaviorSubject([{ id: "a" }]);
			const cached = [{ id: "a" }, { id: "b" }];

			const result$ = createHydrationBuffer(
				cached,
				liveItems$,
				500,
				(i) => i.id,
				// no isConverged
			);

			const results: { items: unknown[]; isHydrating: boolean }[] = [];
			result$.subscribe((r) => results.push(r));

			// Advance past grace period
			vi.advanceTimersByTime(600);

			// Should end hydration on timer alone
			expect(results[results.length - 1]?.isHydrating).toBe(false);
			expect(results[results.length - 1]?.items).toEqual([{ id: "a" }]);
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

	it("with convergence check, keeps hydrating until all cached wallets have live accounts", () => {
		const liveAccounts$ = new BehaviorSubject<
			{ id: string; walletId: string }[]
		>([]);
		const cachedAccounts = [
			{ id: "acc1", walletId: "wallet1" },
			{ id: "acc2", walletId: "wallet2" },
		];

		const isConverged = (
			live: { id: string; walletId: string }[],
			cached: { id: string; walletId: string }[],
		) => {
			const cachedWalletIds = new Set(cached.map((a) => a.walletId));
			const liveWalletIds = new Set(live.map((a) => a.walletId));
			return [...cachedWalletIds].every((id) => liveWalletIds.has(id));
		};

		const result$ = createAccountHydrationBuffer(
			cachedAccounts,
			liveAccounts$,
			500,
			(a) => a.walletId,
			isConverged,
		);

		const results: { items: unknown[]; isHydrating: boolean }[] = [];
		result$.subscribe((r) => results.push(r));

		// Advance past grace period
		vi.advanceTimersByTime(600);

		// Still hydrating - no live accounts for either wallet
		expect(results[results.length - 1]?.isHydrating).toBe(true);

		// wallet1 provides accounts
		liveAccounts$.next([{ id: "acc1", walletId: "wallet1" }]);

		// Still hydrating - wallet2 hasn't provided accounts
		expect(results[results.length - 1]?.isHydrating).toBe(true);

		// wallet2 provides accounts
		liveAccounts$.next([
			{ id: "acc1", walletId: "wallet1" },
			{ id: "acc2", walletId: "wallet2" },
		]);

		// Now converged - hydration ends
		expect(results[results.length - 1]?.isHydrating).toBe(false);
	});
});
