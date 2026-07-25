/**
 * Consumes the built declarations the way a published package is consumed —
 * through the `import` condition, so `dist/index.d.mts`. Keep guard.cts in sync;
 * it covers the CJS declarations, which fail the same way.
 *
 * `skipLibCheck` is off (see tsconfig.json), so tsc reports dangling references
 * across the whole declaration surface on its own — that is what catches the
 * undeclared `P_1` and bare `KheopskitState` of 5.1.1. The one failure mode it
 * cannot see is a type degraded to `any`, since `any` satisfies every ordinary
 * assertion, hence the explicit checks below.
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

/** `0 extends 1 & T` holds only for `any`. */
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
