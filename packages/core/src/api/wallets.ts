import {
	combineLatest,
	filter,
	map,
	mergeMap,
	Observable,
	of,
	shareReplay,
	take,
	tap,
} from "rxjs";
import { sortWallets } from "../utils/sortWallets";
import { getWalletConnectWallet$ } from "./appKit";
import { KheopskitError } from "./errors";
import { createReconnectPolicy, reconnectAccepts } from "./reconnectPolicy";
import type { KheopskitStore } from "./store";
import type {
	BaseWallet,
	KheopskitConfig,
	PlatformContext,
	WalletConnectWallet,
} from "./types";
import { isInjectedWallet } from "./types";

export const getWallets$ = (config: KheopskitConfig, store: KheopskitStore) => {
	// lock the list of wallets to auto reconnect on first call
	const rememberedWalletIds$ = store.observable.pipe(
		map((s) => s.remembered ?? []),
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

		const reconnect = async (wallet: BaseWallet) => {
			try {
				await reconnectPolicy.attempt(wallet.id, () => wallet.connect());
			} catch (err) {
				if (subscriber.closed) return;
				if (err instanceof KheopskitError) {
					if (err.code === "USER_REJECTED") store.forgetWallet(wallet.id);
					if (err.code === "USER_REJECTED" || err.code === "ABORTED")
						reconnectPolicy.settle(wallet.id);
				}
				if (config.debug)
					console.debug("[kheopskit] reconnect of %s failed", wallet.id, err);
			}
		};

		const subWallets = wallets$.subscribe(subscriber);

		const subAutoReconnect = combineLatest([wallets$, rememberedWalletIds$])
			.pipe(
				filter(
					([, walletIds]) =>
						config.autoReconnect !== false && walletIds.length > 0,
				),
				mergeMap(([wallets, walletIds]) =>
					wallets
						.filter(isInjectedWallet)
						.filter((wallet) => walletIds.includes(wallet.id)),
				),
				tap((wallet) => {
					if (wallet.status !== "disconnected")
						reconnectPolicy.settle(wallet.id);
				}),
				filter(
					(wallet) =>
						wallet.status === "disconnected" &&
						reconnectAccepts(config.autoReconnect, wallet),
				),
			)
			.subscribe(reconnect);

		return () => {
			subAutoReconnect.unsubscribe();
			subWallets.unsubscribe();
		};
	}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));
};
