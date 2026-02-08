import {
	createStore as createMipdStore,
	type EIP6963ProviderDetail,
} from "mipd";
import {
	BehaviorSubject,
	combineLatest,
	distinctUntilChanged,
	map,
	Observable,
	shareReplay,
} from "rxjs";
import type { EIP1193Provider } from "viem";
import { getWalletId, type WalletId } from "../../utils/WalletId";
import { getAppKitWallets$ } from "../appKit";
import { store as defaultStore, type KheopskitStore } from "../store";
import type {
	EthereumInjectedWallet,
	EthereumWallet,
	KheopskitConfig,
} from "../types";

/**
 * Observable that emits EIP-6963 provider details from injected wallets.
 * Returns empty array during SSR since browser wallet APIs are not available.
 */
const providersDetails$ = new Observable<EIP6963ProviderDetail[]>(
	(subscriber) => {
		// Guard against SSR - mipd requires browser APIs
		if (typeof window === "undefined") {
			subscriber.next([]);
			return () => {};
		}

		const mipdStore = createMipdStore();

		const unsubscribe = mipdStore.subscribe((providerDetails) => {
			subscriber.next(providerDetails as EIP6963ProviderDetail[]);
		});

		const providerDetails = mipdStore.getProviders();

		subscriber.next(providerDetails as EIP6963ProviderDetail[]);

		return () => {
			unsubscribe();
			mipdStore.destroy();
		};
	},
).pipe(shareReplay({ refCount: true, bufferSize: 1 }));

const createEthereumInjectedWallets$ = (store: KheopskitStore) =>
	new Observable<EthereumInjectedWallet[]>((subscriber) => {
		const enabledWalletIds$ = new BehaviorSubject<Set<WalletId>>(new Set());

		const connectWallet = async (
			walletId: WalletId,
			provider: EIP1193Provider,
		) => {
			if (enabledWalletIds$.value.has(walletId))
				throw new Error(`Extension ${walletId} already connected`);

			await provider.request({
				method: "eth_requestAccounts",
			});

			const newSet = new Set(enabledWalletIds$.value);
			newSet.add(walletId);
			enabledWalletIds$.next(newSet);

			store.addEnabledWalletId(walletId);
		};

		const disconnectWallet = async (walletId: WalletId) => {
			if (!enabledWalletIds$.value.has(walletId))
				throw new Error(`Extension ${walletId} is not connected`);
			const newSet = new Set(enabledWalletIds$.value);
			newSet.delete(walletId);
			enabledWalletIds$.next(newSet);

			store.removeEnabledWalletId(walletId);
		};

		const sub = combineLatest([providersDetails$, enabledWalletIds$])
			.pipe(
				map(([providerDetails, enabledWalletIds]) => {
					return providerDetails.map((pd): EthereumInjectedWallet => {
						const walletId = getWalletId("ethereum", pd.info.rdns);
						const provider = pd.provider as EIP1193Provider;

						return {
							platform: "ethereum",
							type: "injected",
							id: walletId,
							name: pd.info.name,
							icon: pd.info.icon,
							provider,
							isConnected: enabledWalletIds.has(walletId),
							providerId: pd.info.rdns,
							connect: () => connectWallet(walletId, provider),
							disconnect: () => disconnectWallet(walletId),
						};
					});
				}),
				distinctUntilChanged(walletsEqual),
			)
			.subscribe(subscriber);

		return () => {
			sub.unsubscribe();
		};
	}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));

export const getEthereumWallets$ = (
	config: KheopskitConfig,
	store: KheopskitStore = defaultStore,
) => {
	return new Observable<EthereumWallet[]>((subscriber) => {
		const subscription = combineLatest([
			createEthereumInjectedWallets$(store),
			getAppKitWallets$(config)?.pipe(map((w) => w.ethereum)),
		])
			.pipe(
				map(([injectedWallets, appKitWallet]) =>
					appKitWallet ? [...injectedWallets, appKitWallet] : injectedWallets,
				),
			)
			.subscribe(subscriber);

		return () => {
			subscription.unsubscribe();
		};
	}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));
};

/**
 * Compare two wallet arrays by their relevant properties (not functions).
 */
const walletsEqual = (
	a: EthereumInjectedWallet[],
	b: EthereumInjectedWallet[],
): boolean => {
	if (a.length !== b.length) return false;
	return a.every(
		(w, i) =>
			w.id === b[i]?.id &&
			w.isConnected === b[i]?.isConnected &&
			w.name === b[i]?.name,
	);
};
