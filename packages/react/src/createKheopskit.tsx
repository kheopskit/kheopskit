import {
	createKheopskitStore,
	getKheopskit$,
	type KheopskitConfig,
	type KheopskitPlatform,
	type KheopskitState,
	type KheopskitStore,
	resolveConfig,
	type WalletAccountId,
	type WalletId,
} from "@kheopskit/core";
import { type FC, type PropsWithChildren, useCallback } from "react";
import { defer, type Observable, shareReplay } from "rxjs";
import { KheopskitSourceProvider } from "./KheopskitSourceProvider";
import { useAccount } from "./useAccount";
import { useWallet } from "./useWallet";
import { useWallets } from "./useWallets";

export type CreateKheopskitConfig<P extends readonly KheopskitPlatform[]> =
	Omit<Partial<KheopskitConfig<P>>, "platforms"> & {
		/** Platform plugins, e.g. `[polkadot(), solana()]`. Required. */
		platforms: P;
	};

export type CreateKheopskitOptions = {
	/**
	 * Store the shared instance reads the cache from and persists into. Pass one
	 * when code outside React reads `store` or subscribes `kheopskit$` before
	 * the provider renders in an SSR app, and in tests.
	 */
	store?: KheopskitStore;
};

const deferredStore = (claim: () => KheopskitStore): KheopskitStore => ({
	observable: defer(() => claim().observable),
	rememberWallet: (walletId) => claim().rememberWallet(walletId),
	forgetWallet: (walletId) => claim().forgetWallet(walletId),
	getCachedState: () => claim().getCachedState(),
	setCachedState: (wallets, accounts) =>
		claim().setCachedState(wallets, accounts),
	destroy: () => claim().destroy(),
});

/**
 * Binds a platform tuple once and returns one kheopskit instance: a
 * `KheopskitProvider`, hooks already typed to those platforms, and the
 * `kheopskit$` stream and `store` the provider uses, for code outside React.
 * Subscribing `kheopskit$` while the provider is mounted runs no second
 * pipeline.
 *
 * Without `options.store`, the store is created on first use in the browser:
 * backed by cookies when the provider renders first with `ssrCookies`, by
 * localStorage otherwise. The caller owns `store.destroy()`.
 *
 * @example
 * ```tsx
 * // kheopskit.ts
 * export const { KheopskitProvider, useWallets, useWallet, kheopskit$ } =
 *   createKheopskit({ platforms: [polkadot(), ethereum(), solana()] });
 *
 * // anywhere
 * const { accounts } = useWallets(); // accounts are platform-precise, no generic
 * ```
 */
export const createKheopskit = <
	const P extends readonly [KheopskitPlatform, ...KheopskitPlatform[]],
>(
	config: CreateKheopskitConfig<P>,
	options: CreateKheopskitOptions = {},
) => {
	let claimed: KheopskitStore | undefined;
	const claimStore = (ssrCookies?: string) => {
		claimed ??=
			options.store ??
			createKheopskitStore({
				ssrCookies,
				storageKey: resolveConfig(config).storageKey,
			});
		return claimed;
	};

	const kheopskit$: Observable<KheopskitState<P>> = defer(() =>
		getKheopskit$(config, { store: claimStore() }),
	).pipe(shareReplay({ refCount: true, bufferSize: 1 }));

	const Provider: FC<PropsWithChildren<{ ssrCookies?: string }>> = ({
		children,
		ssrCookies,
	}) => {
		if (typeof window !== "undefined") claimStore(ssrCookies);
		const resolveClientSource = useCallback(
			() => ({
				store: claimStore(ssrCookies),
				kheopskit$: kheopskit$ as unknown as Observable<KheopskitState>,
			}),
			[ssrCookies],
		);
		return (
			<KheopskitSourceProvider
				config={config}
				ssrCookies={ssrCookies}
				resolveClientSource={resolveClientSource}
			>
				{children}
			</KheopskitSourceProvider>
		);
	};
	Provider.displayName = "KheopskitProvider";

	return {
		KheopskitProvider: Provider,
		/** The state stream the provider subscribes to, shared with code outside React. */
		kheopskit$,
		/** The store `kheopskit$` reads the cache from and persists into. */
		store: options.store ?? deferredStore(claimStore),
		/** Current state, typed to the bound platform tuple. */
		useWallets: () => useWallets<P>(),
		/** Current accounts, typed to the bound platform tuple. */
		useAccounts: () => useWallets<P>().accounts,
		/** The wallet with this id, typed to the bound platform tuple. */
		useWallet: (walletId: WalletId) => useWallet<P>(walletId),
		/** The account with this id, typed to the bound platform tuple. */
		useAccount: (accountId: WalletAccountId) => useAccount<P>(accountId),
	};
};
