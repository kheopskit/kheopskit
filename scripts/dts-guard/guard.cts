/**
 * Same checks as guard.mts, resolved through the `require` condition so they
 * land on the CJS declarations (`dist/index.d.ts`). Keep in sync with guard.mts.
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

type NotAny<T> = 0 extends 1 & T ? false : true;

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

type Present<T> = Exclude<T, undefined>;

export type SigningSurfacesAreTyped = Expect<
	NoneAny<
		[
			Present<PolkadotAccount["txCreator"]>,
			Present<EthereumAccount["client"]>,
			Present<SolanaAccount["signer"]>,
			Present<EthereumWallet["provider"]>,
		]
	>
>;

export const polkadotTxCreator = (account: PolkadotAccount) => {
	// @ts-expect-error a placeholder has no txCreator
	const unnarrowed: Present<PolkadotAccount["txCreator"]> = account.txCreator;
	if (account.isPlaceholder) return unnarrowed;
	const narrowed: Present<PolkadotAccount["txCreator"]> = account.txCreator;
	return narrowed;
};

export const ethereumClient = (account: EthereumAccount) => {
	// @ts-expect-error a placeholder has no client
	const unnarrowed: Present<EthereumAccount["client"]> = account.client;
	if (account.isPlaceholder) return unnarrowed;
	const narrowed: Present<EthereumAccount["client"]> = account.client;
	return narrowed;
};

export const solanaSigner = (account: SolanaAccount) => {
	// @ts-expect-error a placeholder has no signer
	const unnarrowed: SolanaSigner = account.signer;
	if (account.isPlaceholder) return unnarrowed;
	const narrowed: SolanaSigner = account.signer;
	return narrowed;
};

export const ethereumProvider = (wallet: EthereumWallet) => {
	// @ts-expect-error a placeholder has no provider
	const unnarrowed: Present<EthereumWallet["provider"]> = wallet.provider;
	if (wallet.isPlaceholder) return unnarrowed;
	const narrowed: Present<EthereumWallet["provider"]> = wallet.provider;
	return narrowed;
};
