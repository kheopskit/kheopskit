import { combineLatest, map, Observable, of, shareReplay } from "rxjs";
import { sortAccounts } from "../utils/sortAccounts";
import type {
	BaseWallet,
	BaseWalletAccount,
	KheopskitConfig,
	WalletConnectWallet,
} from "./types";
import { isWalletConnectWallet } from "./types";

export const getAccounts$ = (
	config: KheopskitConfig,
	wallets: Observable<(BaseWallet | WalletConnectWallet)[]>,
) => {
	return new Observable<BaseWalletAccount[]>((subscriber) => {
		// Each plugin gets its own platform's (injected) wallets plus the shared
		// WalletConnect connector; it derives WC accounts only for the namespaces
		// the session carries.
		const sources = config.platforms.map((plugin) =>
			plugin.getAccounts$(
				wallets.pipe(
					map((ws) =>
						ws.filter(
							(w) => isWalletConnectWallet(w) || w.platform === plugin.platform,
						),
					),
				),
			),
		);

		const accounts$ = sources.length
			? combineLatest(sources).pipe(
					map((accounts) => accounts.flat().sort(sortAccounts)),
				)
			: of<BaseWalletAccount[]>([]);

		const sub = accounts$.subscribe(subscriber);

		return () => {
			sub.unsubscribe();
		};
	}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));
};
