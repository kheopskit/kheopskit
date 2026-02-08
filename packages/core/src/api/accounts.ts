import { combineLatest, map, Observable, of, shareReplay } from "rxjs";
import { sortAccounts } from "../utils/sortAccounts";
import { getEthereumAccounts$ } from "./ethereum/accounts";
import { getPolkadotAccounts$ } from "./polkadot/accounts";
import type { KheopskitConfig, Wallet, WalletAccount } from "./types";

export const getAccounts$ = (
	config: KheopskitConfig,
	wallets: Observable<Wallet[]>,
) => {
	return new Observable<WalletAccount[]>((subscriber) => {
		// biome-ignore lint/suspicious/useIterableCallbackReturn: false positive
		const sources = config.platforms.map<Observable<WalletAccount[]>>(
			(platform) => {
				switch (platform) {
					case "polkadot":
						return getPolkadotAccounts$(
							wallets.pipe(
								map((w) => w.filter((w) => w.platform === "polkadot")),
							),
						);
					case "ethereum":
						return getEthereumAccounts$(
							wallets.pipe(
								map((w) => w.filter((w) => w.platform === "ethereum")),
							),
						);
				}
			},
		);

		const accounts$ = sources.length
			? combineLatest(sources).pipe(
					map((accounts) => accounts.flat().sort(sortAccounts)),
				)
			: of([]);

		const sub = accounts$.subscribe(subscriber);

		return () => {
			sub.unsubscribe();
		};
	}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));
};
