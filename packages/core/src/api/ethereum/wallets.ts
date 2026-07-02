import {
	createStore as createMipdStore,
	type EIP6963ProviderDetail,
} from "mipd";
import { Observable, shareReplay } from "rxjs";
import type { EIP1193Provider } from "viem";
import { clearCachedObservable } from "../../utils/getCachedObservable";
import { getWalletId } from "../../utils/WalletId";
import { createInjectedWallets$ } from "../injectedWallets";
import type { KheopskitStore } from "../store";
import type { EthereumInjectedWallet } from "./types";

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

// The shared WalletConnect connector is emitted once by core (see
// `getWallets$`), not per platform — so this returns only injected wallets.
export const getEthereumWallets$ = (store: KheopskitStore) =>
	createInjectedWallets$<EIP6963ProviderDetail, EthereumInjectedWallet>(store, {
		sources$: providersDetails$,
		getWalletId: (pd) => getWalletId("ethereum", pd.info.rdns),
		connect: async (pd) => {
			await (pd.provider as EIP1193Provider).request({
				method: "eth_requestAccounts",
			});
		},
		// Drop the cached account observable so a later reconnect rebuilds it
		// against the current provider, not a stale closure.
		onDisconnected: (walletId) => clearCachedObservable(`accounts:${walletId}`),
		buildWallet: ({
			source: pd,
			walletId,
			isConnected,
			connect,
			disconnect,
		}) => ({
			platform: "ethereum",
			type: "injected",
			id: walletId,
			name: pd.info.name,
			icon: pd.info.icon,
			provider: pd.provider as EIP1193Provider,
			isConnected,
			sourceId: pd.info.rdns,
			connect,
			disconnect,
		}),
	});
