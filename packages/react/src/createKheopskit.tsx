import type { KheopskitConfig, KheopskitPlatform } from "@kheopskit/core";
import type { FC, PropsWithChildren } from "react";
import { KheopskitProvider } from "./KheopskitProvider";
import { useWallets } from "./useWallets";

export type CreateKheopskitConfig<P extends readonly KheopskitPlatform[]> =
	Omit<Partial<KheopskitConfig<P>>, "platforms"> & {
		/** Platform plugins, e.g. `[polkadot(), solana()]`. Required. */
		platforms: P;
	};

/**
 * Binds a platform tuple once and returns a `KheopskitProvider` plus hooks
 * (`useWallets`, `useAccounts`) already typed to those platforms — so you don't
 * repeat `useWallets<typeof platforms>()` in every component.
 *
 * @example
 * ```tsx
 * // kheopskit.ts
 * export const { KheopskitProvider, useWallets, useAccounts } = createKheopskit({
 *   platforms: [polkadot(), ethereum(), solana()],
 * });
 *
 * // anywhere
 * const { accounts } = useWallets(); // accounts are platform-precise, no generic
 * ```
 */
export const createKheopskit = <
	const P extends readonly [KheopskitPlatform, ...KheopskitPlatform[]],
>(
	config: CreateKheopskitConfig<P>,
) => {
	const Provider: FC<PropsWithChildren<{ ssrCookies?: string }>> = ({
		children,
		ssrCookies,
	}) => (
		<KheopskitProvider config={config} ssrCookies={ssrCookies}>
			{children}
		</KheopskitProvider>
	);
	Provider.displayName = "KheopskitProvider";

	return {
		KheopskitProvider: Provider,
		/** Current state, typed to the bound platform tuple. */
		useWallets: () => useWallets<P>(),
		/** Current accounts, typed to the bound platform tuple. */
		useAccounts: () => useWallets<P>().accounts,
	};
};
