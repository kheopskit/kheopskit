import {
	combineLatest,
	distinctUntilChanged,
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
				if (err instanceof KheopskitError && err.code === "USER_REJECTED") {
					store.forgetWallet(wallet.id);
					reconnectPolicy.refuse(wallet.id);
				}
				if (config.debug)
					console.debug("[kheopskit] reconnect of %s failed", wallet.id, err);
			}
		};

		const subAutoReconnect = combineLatest([
			wallets$.pipe(distinctUntilChanged(sameDiscovery)),
			rememberedWalletIds$,
		])
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
				filter(
					(wallet) =>
						wallet.status === "disconnected" &&
						reconnectAccepts(config.autoReconnect, wallet),
				),
			)
			.subscribe(reconnect);

		const subWallets = wallets$.subscribe(subscriber);

		return () => {
			subAutoReconnect.unsubscribe();
			subWallets.unsubscribe();
		};
	}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));
};

/**
 * A reconnect is re-attempted when discovery changes (a wallet appears, is
 * renamed, connects or disconnects), not when an attempt's own `connecting`
 * or `error` transition re-emits the list.
 */
const sameDiscovery = (
	a: (BaseWallet | WalletConnectWallet)[],
	b: (BaseWallet | WalletConnectWallet)[],
): boolean =>
	a.length === b.length &&
	a.every(
		(w, i) =>
			w.id === b[i]?.id &&
			w.isConnected === b[i]?.isConnected &&
			w.name === b[i]?.name,
	);
