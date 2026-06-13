import { getWallets } from "@wallet-standard/app";
import type { Wallet as WalletStandardWallet } from "@wallet-standard/base";
import type {
	StandardConnectFeature,
	StandardDisconnectFeature,
} from "@wallet-standard/features";
import {
	BehaviorSubject,
	combineLatest,
	distinctUntilChanged,
	map,
	Observable,
	shareReplay,
} from "rxjs";
import { clearCachedObservablesByPrefix } from "../../utils/getCachedObservable";
import { getWalletId, type WalletId } from "../../utils/WalletId";
import { getAppKitWallets$ } from "../appKit";
import { store as defaultStore, type KheopskitStore } from "../store";
import type { KheopskitConfig } from "../types";
import { isSolanaChainId, type SolanaChainId } from "./chains";
import type { SolanaInjectedWallet, SolanaWallet } from "./types";

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

const createSolanaInjectedWallets$ = (store: KheopskitStore) =>
	new Observable<SolanaInjectedWallet[]>((subscriber) => {
		const enabledWalletIds$ = new BehaviorSubject<Set<WalletId>>(new Set());

		const connect = async (
			wallet: WalletStandardWallet,
			walletId: WalletId,
		) => {
			if (enabledWalletIds$.value.has(walletId))
				throw new Error(`Wallet ${walletId} already connected`);

			const feature = (wallet.features as Record<string, unknown>)[
				"standard:connect"
			] as ConnectApi | undefined;
			if (!feature)
				throw new Error(`Wallet ${walletId} does not support standard:connect`);

			await feature.connect();

			const newSet = new Set(enabledWalletIds$.value);
			newSet.add(walletId);
			enabledWalletIds$.next(newSet);

			store.addEnabledWalletId(walletId);
		};

		const disconnect = (wallet: WalletStandardWallet, walletId: WalletId) => {
			if (!enabledWalletIds$.value.has(walletId))
				throw new Error(`Wallet ${walletId} is not connected`);

			// standard:disconnect is an optional feature - never throw if missing
			const feature = (wallet.features as Record<string, unknown>)[
				"standard:disconnect"
			] as DisconnectApi | undefined;
			void feature?.disconnect();

			const newSet = new Set(enabledWalletIds$.value);
			newSet.delete(walletId);
			enabledWalletIds$.next(newSet);

			store.removeEnabledWalletId(walletId);

			// Drop cached account observables for this wallet so a later reconnect
			// rebuilds them against the current wallet handle, not a stale closure.
			clearCachedObservablesByPrefix(`accounts:${walletId}:`);
		};

		const sub = combineLatest([walletStandardWallets$, enabledWalletIds$])
			.pipe(
				map(([wallets, enabledWalletIds]) =>
					wallets.map((wallet): SolanaInjectedWallet => {
						const walletId = getWalletId("solana", wallet.name);

						return {
							platform: "solana",
							type: "injected",
							id: walletId,
							walletStandardId: wallet.name,
							wallet,
							chains: getSolanaChains(wallet),
							name: wallet.name,
							icon: wallet.icon,
							isConnected: enabledWalletIds.has(walletId),
							connect: () => connect(wallet, walletId),
							disconnect: () => disconnect(wallet, walletId),
						};
					}),
				),
				distinctUntilChanged(walletsEqual),
			)
			.subscribe(subscriber);

		return () => {
			sub.unsubscribe();
		};
	}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));

export const getSolanaWallets$ = (
	config: KheopskitConfig,
	store: KheopskitStore = defaultStore,
) => {
	return new Observable<SolanaWallet[]>((subscriber) => {
		const subscription = combineLatest([
			createSolanaInjectedWallets$(store),
			getAppKitWallets$(config).pipe(map((w) => w.solana)),
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
	a: SolanaInjectedWallet[],
	b: SolanaInjectedWallet[],
): boolean => {
	if (a.length !== b.length) return false;
	return a.every(
		(w, i) =>
			w.id === b[i]?.id &&
			w.isConnected === b[i]?.isConnected &&
			w.name === b[i]?.name,
	);
};
