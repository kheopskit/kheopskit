import { getWallets } from "@wallet-standard/app";
import type { Wallet as WalletStandardWallet } from "@wallet-standard/base";
import type {
	StandardConnectFeature,
	StandardDisconnectFeature,
} from "@wallet-standard/features";
import { Observable, shareReplay } from "rxjs";
import { clearCachedObservablesByPrefix } from "../../utils/getCachedObservable";
import { getWalletId } from "../../utils/WalletId";
import { KheopskitError } from "../errors";
import { createInjectedWallets$ } from "../injectedWallets";
import type { KheopskitStore } from "../store";
import { isSolanaChainId, type SolanaChainId } from "./chains";
import type { SolanaInjectedWallet } from "./types";

type ConnectApi = StandardConnectFeature["standard:connect"];
type DisconnectApi = StandardDisconnectFeature["standard:disconnect"];

const SOLANA_NAMESPACE_PREFIX = "solana:";

/** A Wallet Standard wallet is Solana-capable if it advertises a solana chain or feature. */
const isSolanaWallet = (wallet: WalletStandardWallet): boolean =>
	wallet.chains.some((chain) => chain.startsWith(SOLANA_NAMESPACE_PREFIX)) ||
	Object.keys(wallet.features).some((feature) =>
		feature.startsWith(SOLANA_NAMESPACE_PREFIX),
	);

const getSolanaChains = (wallet: WalletStandardWallet): SolanaChainId[] =>
	wallet.chains.filter((chain): chain is SolanaChainId =>
		isSolanaChainId(chain),
	);

/**
 * Observable of Solana-capable Wallet Standard wallets, updated as wallets
 * register/unregister. Returns an empty array during SSR.
 */
const walletStandardWallets$ = new Observable<readonly WalletStandardWallet[]>(
	(subscriber) => {
		// Guard against SSR - the Wallet Standard registry requires browser APIs
		if (typeof window === "undefined") {
			subscriber.next([]);
			return () => {};
		}

		const { get, on } = getWallets();
		const emit = () => subscriber.next(get().filter(isSolanaWallet));

		emit();

		const offRegister = on("register", emit);
		const offUnregister = on("unregister", emit);

		return () => {
			offRegister();
			offUnregister();
		};
	},
).pipe(shareReplay({ refCount: true, bufferSize: 1 }));

// The shared WalletConnect connector is emitted once by core (see
// `getWallets$`), not per platform — so this returns only injected wallets.
export const getSolanaWallets$ = (store: KheopskitStore) =>
	createInjectedWallets$<WalletStandardWallet, SolanaInjectedWallet>(store, {
		sources$: walletStandardWallets$,
		getWalletId: (wallet) => getWalletId("solana", wallet.name),
		connect: async (wallet, walletId) => {
			const feature = (wallet.features as Record<string, unknown>)[
				"standard:connect"
			] as ConnectApi | undefined;
			if (!feature)
				throw new KheopskitError(
					"FEATURE_NOT_SUPPORTED",
					`wallet ${walletId} does not support standard:connect`,
					{ walletId },
				);

			await feature.connect();
		},
		// standard:disconnect is an optional feature. Await it when present so a
		// failed disconnect rejects the returned promise; if absent we still
		// clear local state.
		disconnect: async (wallet) => {
			const feature = (wallet.features as Record<string, unknown>)[
				"standard:disconnect"
			] as DisconnectApi | undefined;
			await feature?.disconnect();
		},
		// Drop cached account observables for this wallet so a later reconnect
		// rebuilds them against the current wallet handle, not a stale closure.
		onDisconnected: (walletId) =>
			clearCachedObservablesByPrefix(`accounts:${walletId}:`),
		buildWallet: ({
			source: wallet,
			walletId,
			isConnected,
			connect,
			disconnect,
		}) => ({
			platform: "solana",
			type: "injected",
			id: walletId,
			sourceId: wallet.name,
			wallet,
			chains: getSolanaChains(wallet),
			name: wallet.name,
			icon: wallet.icon,
			isConnected,
			connect,
			disconnect,
		}),
	});
