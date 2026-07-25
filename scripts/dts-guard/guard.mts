/**
 * Consumer's-eye assertions over the built ESM declarations
 * (`dist/index.d.mts`, reached through the `import` condition).
 *
 * Run by `pnpm check:dts`. See scripts/check-dts.mjs for why this exists: the
 * declaration emit silently degrades types it cannot resolve to `any`, so a
 * broken build is only visible from outside the package. Keep guard.cts in sync
 * — it covers the CJS declarations, which fail the same way.
 */

import type {
	AccountOf,
	KheopskitPlatform,
	KheopskitState,
} from "@kheopskit/core";
import type {
	createKheopskit,
	useAccounts,
	useWallets,
} from "@kheopskit/react";

/**
 * `0 extends 1 & T` holds only for `any` — the 5.1.1 failure mode. It needs its
 * own detector because `any` satisfies every ordinary assertion.
 */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** Invariant-position comparison, so `any` never passes for the real type. */
type Equals<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

type Expect<T extends true> = T;

type Platforms = readonly [KheopskitPlatform, KheopskitPlatform];
type Bound = ReturnType<typeof createKheopskit<Platforms>>;

export type StandaloneAccountsAreNotAny = Expect<
	Equals<IsAny<ReturnType<typeof useAccounts>>, false>
>;
export type StandaloneAccountsAreTyped = Expect<
	Equals<ReturnType<typeof useAccounts>, AccountOf<KheopskitPlatform>[]>
>;
export type StandaloneWalletsAreNotAny = Expect<
	Equals<IsAny<ReturnType<typeof useWallets>>, false>
>;
export type StandaloneWalletsAreTyped = Expect<
	Equals<
		ReturnType<typeof useWallets>,
		KheopskitState<readonly KheopskitPlatform[]>
	>
>;

export type BoundAccountsAreNotAny = Expect<
	Equals<IsAny<ReturnType<Bound["useAccounts"]>>, false>
>;
export type BoundAccountsAreTyped = Expect<
	Equals<ReturnType<Bound["useAccounts"]>, AccountOf<KheopskitPlatform>[]>
>;
export type BoundWalletsAreNotAny = Expect<
	Equals<IsAny<ReturnType<Bound["useWallets"]>>, false>
>;
export type BoundWalletsAreTyped = Expect<
	Equals<ReturnType<Bound["useWallets"]>, KheopskitState<Platforms>>
>;
