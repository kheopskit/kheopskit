import { combineLatest, map, Observable, of, shareReplay } from "rxjs";
import { sortAccounts } from "../utils/sortAccounts";
import type { BaseWallet, BaseWalletAccount, KheopskitConfig } from "./types";

export const getAccounts$ = (
	config: KheopskitConfig,
	wallets: Observable<BaseWallet[]>,
) => {
	return new Observable<BaseWalletAccount[]>((subscriber) => {
		const sources = config.platforms.map((plugin) =>
			plugin.getAccounts$(
				wallets.pipe(
					map((ws) => ws.filter((w) => w.platform === plugin.platform)),
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
