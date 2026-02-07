import {
	combineLatest,
	distinct,
	filter,
	map,
	mergeMap,
	Observable,
	of,
	shareReplay,
	startWith,
	take,
} from "rxjs";
import { sortWallets } from "../utils/sortWallets";
import { getEthereumWallets$ } from "./ethereum/wallets";
import { getPolkadotWallets$ } from "./polkadot/wallets";
import { store as defaultStore, type KheopskitStore } from "./store";
import type { KheopskitConfig, Wallet } from "./types";

export const getWallets$ = (
	config: KheopskitConfig,
	store: KheopskitStore = defaultStore,
) => {
	// lock the list of wallets to auto reconnect on first call
	const autoReconnectWalletIds$ = store.observable.pipe(
		map((s) => s.autoReconnect ?? []),
		take(1),
		shareReplay(1),
	);

	return new Observable<Wallet[]>((subscriber) => {
		// biome-ignore lint/suspicious/useIterableCallbackReturn: false positive
		const observables = config.platforms.map(
			(platform): Observable<Wallet[]> => {
				switch (platform) {
					case "polkadot":
						return getPolkadotWallets$(config, store);
					case "ethereum":
						return getEthereumWallets$(config, store);
				}
			},
		);

		const wallets$ = observables.length
			? combineLatest(observables).pipe(
					map((wallets) => wallets.flat().sort(sortWallets)),
					// Emit empty array immediately so UI doesn't wait
					startWith([] as Wallet[]),
				)
			: of([]);

		// Track wallets being reconnected to avoid duplicate attempts
		const reconnectingWallets = new Set<string>();

		const subAutoReconnect = combineLatest([wallets$, autoReconnectWalletIds$])
			.pipe(
				filter(([, walletIds]) => config.autoReconnect && !!walletIds?.length),
				mergeMap(([wallets, walletIds]) =>
					wallets.filter((wallet) => walletIds?.includes(wallet.id)),
				),
				distinct((w) => w.id),
			)
			.subscribe(async (wallet) => {
				if (wallet.isConnected || reconnectingWallets.has(wallet.id)) {
					return;
				}

				reconnectingWallets.add(wallet.id);
				try {
					await wallet.connect();
				} catch (err) {
					console.error("Failed to reconnect wallet %s", wallet.id, { err });
				} finally {
					reconnectingWallets.delete(wallet.id);
				}
			});

		const subWallets = wallets$.subscribe(subscriber);

		return () => {
			subAutoReconnect.unsubscribe();
			subWallets.unsubscribe();
		};
	}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));
};
