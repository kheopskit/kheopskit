import { hydrateAccount, hydrateWallet } from "../utils/hydrateState";
import { getCachedIcon } from "../utils/iconCache";
import { sortAccounts } from "../utils/sortAccounts";
import { sortWallets } from "../utils/sortWallets";
import { acceptsCachedAccount, acceptsCachedWallet } from "./platform";
import { reconnectAccepts } from "./reconnectPolicy";
import type { KheopskitStore } from "./store";
import type {
	BaseWallet,
	BaseWalletAccount,
	KheopskitConfig,
	WalletConnectWallet,
} from "./types";
import { isInjectedWallet } from "./types";

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
 * Builds placeholder wallets and accounts from the store's cached state,
 * sorted like the live pipeline. Omits wallets of platforms missing from
 * `config.platforms`, the WalletConnect row when `config.walletConnect` is
 * unset, and every account of a platform missing from `config.platforms` or
 * of an omitted wallet. A cached connected injected wallet that
 * `autoReconnect` rejects comes back `disconnected`, and a wallet that comes
 * back `disconnected` has no accounts. Each remaining account must pass its
 * platform plugin's `acceptsCachedAccount` hook.
 *
 * This is the single implementation behind the observable's initial seed and
 * both React snapshot sources (`serverValue`/`initialValue`). They must produce
 * the same shape in the same order or the UI flickers/reorders on reload — by
 * sharing this helper, that agreement holds by construction.
 */
export const getHydratedSnapshot = (
	store: KheopskitStore,
	config: Pick<
		KheopskitConfig,
		"platforms" | "autoReconnect" | "walletConnect"
	>,
	options: GetHydratedSnapshotOptions = {},
): HydratedSnapshot => {
	const cached = store.getCachedState();
	const unconfigured = new Set(
		cached.wallets
			.filter((wallet) => !acceptsCachedWallet(wallet, config))
			.map((wallet) => wallet.id),
	);

	const wallets = cached.wallets
		.filter((wallet) => !unconfigured.has(wallet.id))
		.map(hydrateWallet)
		.map((wallet) =>
			wallet.status === "connecting" &&
			isInjectedWallet(wallet) &&
			!reconnectAccepts(config.autoReconnect, wallet)
				? { ...wallet, status: "disconnected" as const }
				: wallet,
		)
		.map((wallet) => {
			// Some wallets (e.g. Ethereum) have no SSR-safe icon; optionally fill it
			// from the localStorage cache.
			if (!options.icons || wallet.icon) return wallet;
			const icon = getCachedIcon(wallet.id);
			return icon ? { ...wallet, icon } : wallet;
		})
		.sort(sortWallets);

	const withoutAccounts = new Set([
		...unconfigured,
		...wallets.filter((w) => w.status === "disconnected").map((w) => w.id),
	]);

	const accounts = cached.accounts
		.filter((account) => !withoutAccounts.has(account.walletId))
		.filter((account) => acceptsCachedAccount(account, config.platforms))
		.map(hydrateAccount)
		.sort(sortAccounts);

	return { wallets, accounts };
};
