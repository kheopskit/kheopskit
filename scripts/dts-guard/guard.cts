/**
 * Same assertions as guard.mts, but resolved through the `require` condition so
 * they land on the built CJS declarations (`dist/index.d.ts`). Both outputs come
 * out of the same declaration emit and broke together in 5.1.1, so both are
 * checked. Keep in sync with guard.mts.
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

type IsAny<T> = 0 extends 1 & T ? true : false;

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
