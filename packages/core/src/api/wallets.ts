import {
	combineLatest,
	filter,
	map,
	mergeMap,
	Observable,
	of,
	shareReplay,
	tap,
	withLatestFrom,
} from "rxjs";
import { sortWallets } from "../utils/sortWallets";
import { KheopskitError } from "./errors";
import {
	createReconnectPolicy,
	reconnectAccepts,
	reconnectCandidates$,
} from "./reconnectPolicy";
import type { KheopskitStore } from "./store";
import type {
	BaseWallet,
	ConnectOptions,
	KheopskitConfig,
	PlatformContext,
	WalletConnectWallet,
} from "./types";
import { isInjectedWallet } from "./types";

export const getWallets$ = (
	config: KheopskitConfig,
	store: KheopskitStore,
	registryReads$?: Observable<void>,
) => {
	return new Observable<(BaseWallet | WalletConnectWallet)[]>((subscriber) => {
		const ctx: PlatformContext = { config, store, registryReads$ };
		const observables = config.platforms.map((plugin) =>
			plugin.getWallets$(ctx),
		);

		const reconnectPolicy = createReconnectPolicy();

		const settleOnUserCall = <W extends BaseWallet>(wallet: W): W => ({
			...wallet,
			connect: (options?: ConnectOptions) => {
				reconnectPolicy.settle(wallet.id);
				return wallet.connect(options);
			},
			disconnect: () => {
				reconnectPolicy.settle(wallet.id);
				return wallet.disconnect();
			},
		});

		const platformWallets$ = observables.length
			? combineLatest(observables).pipe(map((wallets) => wallets.flat()))
			: of<BaseWallet[]>([]);

		// The single, platform-less WalletConnect connector is appended here (not
		// emitted per platform). It sorts last (see sortWallets).
		const walletConnect$ = config.walletConnect?.getWallet$(ctx);
		const unsortedWallets$: Observable<(BaseWallet | WalletConnectWallet)[]> =
			walletConnect$
				? combineLatest([platformWallets$, walletConnect$]).pipe(
						map(([platformWallets, walletConnect]) =>
							walletConnect
								? [...platformWallets, walletConnect]
								: platformWallets,
						),
					)
				: platformWallets$;
		const rawWallets$ = unsortedWallets$.pipe(
			map((all) => all.sort(sortWallets)),
		);

		const wallets$ = rawWallets$.pipe(
			map((wallets) =>
				wallets.map((wallet) =>
					isInjectedWallet(wallet) ? settleOnUserCall(wallet) : wallet,
				),
			),
		);

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
		if (subscriber.closed) return subWallets;

		const subAutoReconnect = rawWallets$
			.pipe(
				withLatestFrom(reconnectCandidates$(store)),
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
					if (wallet.status === "connected") reconnectPolicy.settle(wallet.id);
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
