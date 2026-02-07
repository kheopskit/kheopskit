import { createStore, type EIP6963ProviderDetail } from "mipd";
import {
	BehaviorSubject,
	combineLatest,
	map,
	Observable,
	shareReplay,
} from "rxjs";
import type { EIP1193Provider } from "viem";
import { store } from "../store";
import type {
	EthereumInjectedWallet,
	EthereumWallet,
	KheopskitConfig,
} from "../types";
import { getWalletId, type WalletId } from "../../utils/WalletId";
import { getAppKitWallets$ } from "../appKit";

const providersDetails$ = new Observable<EIP6963ProviderDetail[]>(
	(subscriber) => {
		const store = createStore();

		const unsubscribe = store.subscribe((providerDetails) => {
			subscriber.next(providerDetails as EIP6963ProviderDetail[]);
		});

		const providerDetails = store.getProviders();

		subscriber.next(providerDetails as EIP6963ProviderDetail[]);

		return () => {
			unsubscribe();
			store.destroy();
		};
	},
).pipe(shareReplay({ refCount: true, bufferSize: 1 }));

const ethereumInjectedWallets$ = new Observable<EthereumInjectedWallet[]>(
	(subscriber) => {
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
			)
			.subscribe(subscriber);

		return () => {
			sub.unsubscribe();
		};
	},
).pipe(shareReplay({ refCount: true, bufferSize: 1 }));

export const getEthereumWallets$ = (config: KheopskitConfig) => {
	return new Observable<EthereumWallet[]>((subscriber) => {
		const subscription = combineLatest([
			ethereumInjectedWallets$,
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
