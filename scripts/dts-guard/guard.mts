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
 *
 * The subpath entry points get the same treatment as the index: core's SDK
 * peerDependencies are all optional, so a publish build that ran without one
 * installed would emit `any` for exactly the types those subpaths exist to
 * provide. Nested `any` inside an otherwise-typed shape is out of reach here —
 * these catch a symbol collapsing whole, which is how 5.1.1 failed.
 */

import type { KheopskitPlatform } from "@kheopskit/core";
import type {
	EthereumAccount,
	EthereumWallet,
	ethereum,
} from "@kheopskit/core/ethereum";
import type {
	serializeAccount,
	serializeWallet,
} from "@kheopskit/core/internal";
import type {
	PolkadotAccount,
	PolkadotWallet,
	polkadot,
} from "@kheopskit/core/polkadot";
import type {
	SolanaAccount,
	SolanaSigner,
	SolanaWallet,
	solana,
} from "@kheopskit/core/solana";
import type {
	createKheopskit,
	useAccounts,
	useWallets,
} from "@kheopskit/react";

/** `0 extends 1 & T` holds only for `any`. */
type NotAny<T> = 0 extends 1 & T ? false : true;

/** Every member typed, so one assertion can cover a whole entry point. */
type NoneAny<T extends readonly unknown[]> = T extends readonly [
	infer Head,
	...infer Rest,
]
	? NotAny<Head> extends true
		? NoneAny<Rest>
		: false
	: true;

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

export type PolkadotIsTyped = Expect<
	NoneAny<[ReturnType<typeof polkadot>, PolkadotAccount, PolkadotWallet]>
>;
export type EthereumIsTyped = Expect<
	NoneAny<[ReturnType<typeof ethereum>, EthereumAccount, EthereumWallet]>
>;
export type SolanaIsTyped = Expect<
	NoneAny<
		[ReturnType<typeof solana>, SolanaAccount, SolanaWallet, SolanaSigner]
	>
>;
// The symbol itself, then its result: `Parameters<any>` would be no use here,
// since it resolves to `unknown[]` rather than propagating the `any`.
export type InternalIsTyped = Expect<
	NoneAny<
		[
			typeof serializeAccount,
			ReturnType<typeof serializeAccount>,
			typeof serializeWallet,
			ReturnType<typeof serializeWallet>,
		]
	>
>;
