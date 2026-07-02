import {
	combineLatest,
	filter,
	map,
	mergeMap,
	Observable,
	of,
	shareReplay,
	take,
} from "rxjs";
import { sortWallets } from "../utils/sortWallets";
import { getWalletConnectWallet$ } from "./appKit";
import { createReconnectPolicy } from "./reconnectPolicy";
import type { KheopskitStore } from "./store";
import type {
	BaseWallet,
	KheopskitConfig,
	PlatformContext,
	WalletConnectWallet,
} from "./types";

export const getWallets$ = (config: KheopskitConfig, store: KheopskitStore) => {
	// lock the list of wallets to auto reconnect on first call
	const autoReconnectWalletIds$ = store.observable.pipe(
		map((s) => s.autoReconnect ?? []),
		take(1),
		shareReplay({ bufferSize: 1, refCount: true }),
	);

	return new Observable<(BaseWallet | WalletConnectWallet)[]>((subscriber) => {
		const ctx: PlatformContext = { config, store };
		const observables = config.platforms.map((plugin) =>
			plugin.getWallets$(ctx),
		);

		const platformWallets$ = observables.length
			? combineLatest(observables).pipe(map((wallets) => wallets.flat()))
			: of<BaseWallet[]>([]);

		// The single, platform-less WalletConnect connector is appended here (not
		// emitted per platform). It sorts last (see sortWallets).
		const wallets$ = combineLatest([
			platformWallets$,
			getWalletConnectWallet$(config),
		]).pipe(
			map(([platformWallets, walletConnect]) => {
				const all: (BaseWallet | WalletConnectWallet)[] = walletConnect
					? [...platformWallets, walletConnect]
					: platformWallets;
				return all.sort(sortWallets);
			}),
			// Note: No startWith([]) here - the hydration buffer handles initial state
		);

		const reconnectPolicy = createReconnectPolicy();

		const subAutoReconnect = combineLatest([wallets$, autoReconnectWalletIds$])
			.pipe(
				filter(([, walletIds]) => config.autoReconnect && !!walletIds?.length),
				mergeMap(([wallets, walletIds]) =>
					wallets.filter((wallet) => walletIds?.includes(wallet.id)),
				),
			)
			.subscribe(async (wallet) => {
				if (wallet.isConnected) return;
				try {
					await reconnectPolicy.attempt(wallet.id, () => wallet.connect());
				} catch (err) {
					console.error("Failed to reconnect wallet %s", wallet.id, { err });
				}
			});

		const subWallets = wallets$.subscribe(subscriber);

		return () => {
			subAutoReconnect.unsubscribe();
			subWallets.unsubscribe();
		};
	}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));
};
