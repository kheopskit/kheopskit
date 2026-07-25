/**
 * Same checks as guard.mts, resolved through the `require` condition so they
 * land on the CJS declarations (`dist/index.d.ts`). Keep in sync with guard.mts.
 */

import type { KheopskitPlatform } from "@kheopskit/core";
import type {} from "@kheopskit/core/ethereum";
import type {} from "@kheopskit/core/internal";
import type {} from "@kheopskit/core/polkadot";
import type {} from "@kheopskit/core/solana";
import type {
	createKheopskit,
	useAccounts,
	useWallets,
} from "@kheopskit/react";

type NotAny<T> = 0 extends 1 & T ? false : true;

type Expect<T extends true> = T;

type Bound = ReturnType<typeof createKheopskit<readonly [KheopskitPlatform]>>;

export type AccountsAreTyped = Expect<NotAny<ReturnType<typeof useAccounts>>>;
export type WalletsAreTyped = Expect<NotAny<ReturnType<typeof useWallets>>>;
export type BoundAccountsAreTyped = Expect<
	NotAny<ReturnType<Bound["useAccounts"]>>
>;
export type BoundWalletsAreTyped = Expect<
	NotAny<ReturnType<Bound["useWallets"]>>
>;
