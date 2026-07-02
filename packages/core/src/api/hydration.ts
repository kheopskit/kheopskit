import { hydrateAccount, hydrateWallet } from "../utils/hydrateState";
import { getCachedIcon } from "../utils/iconCache";
import { sortAccounts } from "../utils/sortAccounts";
import { sortWallets } from "../utils/sortWallets";
import { acceptsCachedAccount } from "./platform";
import type { KheopskitStore } from "./store";
import type {
	BaseWallet,
	BaseWalletAccount,
	KheopskitPlatform,
	WalletConnectWallet,
} from "./types";

/** Result of {@link getHydratedSnapshot}: placeholder wallets and accounts built from the cache. */
export type HydratedSnapshot = {
	wallets: (BaseWallet | WalletConnectWallet)[];
	accounts: BaseWalletAccount[];
};

export type GetHydratedSnapshotOptions = {
	/**
	 * Enrich wallets that have no icon from the localStorage icon cache.
	 *
	 * Must stay `false` for any snapshot that has to match server-rendered markup
	 * (React's `getServerSnapshot` runs on the client during hydration, where the
	 * icon cache is populated — enriching there would diverge from the server,
	 * which always sees an empty cache).
	 */
	icons?: boolean;
};

/**
 * Builds the cached-state snapshot every consumer must agree on: read the
 * store's cached state, hydrate wallets/accounts into placeholders, filter
 * accounts through each platform plugin's `acceptsCachedAccount` hook, and sort
 * with the same comparators the live pipeline uses.
 *
 * This is the single implementation behind the observable's initial seed and
 * both React snapshot sources (`serverValue`/`initialValue`). They must produce
 * the same shape in the same order or the UI flickers/reorders on reload — by
 * sharing this helper, that agreement holds by construction.
 */
export const getHydratedSnapshot = (
	store: KheopskitStore,
	platforms: readonly KheopskitPlatform[],
	options: GetHydratedSnapshotOptions = {},
): HydratedSnapshot => {
	const cached = store.getCachedState();

	const wallets = cached.wallets
		.map((cachedWallet) => {
			const wallet = hydrateWallet(cachedWallet);
			// Some wallets (e.g. Ethereum) have no SSR-safe icon; optionally fill it
			// from the localStorage cache.
			if (!options.icons || wallet.icon) return wallet;
			const icon = getCachedIcon(wallet.id);
			return icon ? { ...wallet, icon } : wallet;
		})
		.sort(sortWallets);

	const accounts = cached.accounts
		.filter((account) => acceptsCachedAccount(account, platforms))
		.map(hydrateAccount)
		.sort(sortAccounts);

	return { wallets, accounts };
};
