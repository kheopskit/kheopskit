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
import { store as defaultStore, type KheopskitStore } from "./store";
import type {
	BaseWallet,
	KheopskitConfig,
	PlatformContext,
	WalletConnectWallet,
} from "./types";

export const getWallets$ = (
	config: KheopskitConfig,
	store: KheopskitStore = defaultStore,
) => {
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

		// Track wallets currently reconnecting (avoid duplicate concurrent attempts)
		// and those already reconnected (so we don't fight a later manual disconnect).
		// A failed attempt is left out of `reconnected`, so it can retry when the
		// wallet next re-emits (e.g. a late-injecting extension).
		const reconnectingWallets = new Set<string>();
		const reconnectedWallets = new Set<string>();
		// Bounded retry: a wallet whose connect() keeps rejecting (e.g. a permission
		// permanently denied, or a buggy provider) must not be re-attempted on every
		// wallets$ emission — the stream re-emits frequently (polkadot polling,
		// mipd/wallet-standard register events). Allow a few attempts so a
		// late-injecting extension that isn't ready on first sight still reconnects,
		// then give up for this session.
		const MAX_RECONNECT_ATTEMPTS = 3;
		const failedAttempts = new Map<string, number>();

		const subAutoReconnect = combineLatest([wallets$, autoReconnectWalletIds$])
			.pipe(
				filter(([, walletIds]) => config.autoReconnect && !!walletIds?.length),
				mergeMap(([wallets, walletIds]) =>
					wallets.filter((wallet) => walletIds?.includes(wallet.id)),
				),
			)
			.subscribe(async (wallet) => {
				if (
					wallet.isConnected ||
					reconnectingWallets.has(wallet.id) ||
					reconnectedWallets.has(wallet.id) ||
					(failedAttempts.get(wallet.id) ?? 0) >= MAX_RECONNECT_ATTEMPTS
				) {
					return;
				}

				reconnectingWallets.add(wallet.id);
				try {
					await wallet.connect();
					reconnectedWallets.add(wallet.id);
					failedAttempts.delete(wallet.id);
				} catch (err) {
					failedAttempts.set(
						wallet.id,
						(failedAttempts.get(wallet.id) ?? 0) + 1,
					);
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
