import {
	type CreateKheopskitConfig,
	type CreateKheopskitOptions,
	createKheopskit as createCoreKheopskit,
	type KheopskitPlatform,
	type WalletAccountId,
	type WalletId,
} from "@kheopskit/core";
import type { FC, PropsWithChildren } from "react";
import { KheopskitSourceProvider } from "./KheopskitSourceProvider";
import { useAccount } from "./useAccount";
import { useWallet } from "./useWallet";
import { useWallets } from "./useWallets";

export type {
	CreateKheopskitConfig,
	CreateKheopskitOptions,
} from "@kheopskit/core";

type ProviderProps<O> = O extends { ssr: true }
	? { ssrCookies?: string }
	: { ssrCookies?: never };

/**
 * Binds a platform tuple once and returns one kheopskit instance: a
 * `KheopskitProvider`, hooks already typed to those platforms, and the
 * `kheopskit$` stream and `store` the provider uses, for code outside React.
 * It is `@kheopskit/core`'s `createKheopskit` instance: subscribing
 * `kheopskit$` while the provider is mounted runs no second pipeline, and
 * holds the one pipeline for every hook action of the instance.
 *
 * Without `options.store`, the store is created on first use, backed by
 * cookies with `{ ssr: true }` and by localStorage otherwise. Only an
 * instance created with `{ ssr: true }` accepts the provider's `ssrCookies`.
 * The caller owns `store.destroy()`.
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
	const O extends CreateKheopskitOptions = CreateKheopskitOptions,
>(
	config: CreateKheopskitConfig<P>,
	options?: O,
) => {
	const kit = createCoreKheopskit(config, options);

	const Provider: FC<PropsWithChildren<{ ssrCookies?: string }>> = ({
		children,
		ssrCookies,
	}) => (
		<KheopskitSourceProvider kit={kit} config={config} ssrCookies={ssrCookies}>
			{children}
		</KheopskitSourceProvider>
	);
	Provider.displayName = "KheopskitProvider";

	return {
		KheopskitProvider: Provider as FC<PropsWithChildren<ProviderProps<O>>>,
		/** The state stream the provider subscribes to, shared with code outside React. */
		kheopskit$: kit.kheopskit$,
		/** The store `kheopskit$` reads the cache from and persists into. */
		store: kit.store,
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
