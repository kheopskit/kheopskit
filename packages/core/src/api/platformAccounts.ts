import {
	combineLatest,
	distinctUntilChanged,
	map,
	Observable,
	of,
	shareReplay,
	switchMap,
} from "rxjs";
import { getCachedObservable$ } from "../utils/getCachedObservable";
import type {
	BaseWallet,
	BaseWalletAccount,
	WalletConnectProvider,
	WalletConnectWallet,
	WalletPlatform,
} from "./types";
import { isWalletConnectWallet } from "./types";

/**
 * The platform-specific surface of an accounts stream. The shared pipeline —
 * filter connected wallets, fan out per-wallet account streams, flatten,
 * change-detect, share — is owned by {@link createPlatformAccounts$}.
 */
export type PlatformAccountsOptions<
	TWallet extends BaseWallet,
	TAccount extends BaseWalletAccount,
> = {
	/** This platform's wallets plus the shared WalletConnect connector. */
	wallets$: Observable<(TWallet | WalletConnectWallet)[]>;
	/** Account stream for one connected injected wallet. */
	getInjectedAccounts$: (wallet: TWallet) => Observable<TAccount[]>;
	/** Account stream for the WalletConnect connector. */
	getWalletConnectAccounts$: (
		wallet: WalletConnectWallet,
	) => Observable<TAccount[]>;
	/** Optional post-flatten transform (e.g. Polkadot's `accountTypes` filter). */
	mapAccounts?: (accounts: TAccount[]) => TAccount[];
	/**
	 * Signature of the account fields that should trigger a re-emission.
	 * Defaults to the account id; platforms add mutable fields (Ethereum
	 * `chainId`, Solana `chains`).
	 */
	accountChangeKey?: (account: TAccount) => string;
};

/** Shared engine behind every platform's `getAccounts$`. */
export const createPlatformAccounts$ = <
	TWallet extends BaseWallet,
	TAccount extends BaseWalletAccount,
>({
	wallets$,
	getInjectedAccounts$,
	getWalletConnectAccounts$,
	mapAccounts,
	accountChangeKey = (account) => account.id,
}: PlatformAccountsOptions<TWallet, TAccount>): Observable<TAccount[]> => {
	const accountsListEqual = (a: TAccount[], b: TAccount[]) =>
		a.length === b.length &&
		a.every((account, i) => {
			const other = b[i];
			return !!other && accountChangeKey(account) === accountChangeKey(other);
		});

	return new Observable<TAccount[]>((subscriber) => {
		const sub = wallets$
			.pipe(
				map((wallets) => wallets.filter((w) => w.isConnected)),
				switchMap((wallets) =>
					wallets.length
						? combineLatest([
								...wallets
									.filter((w): w is TWallet => !isWalletConnectWallet(w))
									.map(getInjectedAccounts$),
								...wallets
									.filter(isWalletConnectWallet)
									.map(getWalletConnectAccounts$),
							])
						: of([]),
				),
				map((accounts) => {
					const flat = accounts.flat();
					return mapAccounts ? mapAccounts(flat) : flat;
				}),
				distinctUntilChanged(accountsListEqual),
			)
			.subscribe(subscriber);

		return () => {
			sub.unsubscribe();
		};
	}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));
};

/**
 * CAIP-10 account strings ("<namespace>:<chainRef>:<address>") the live
 * WalletConnect session carries for a namespace.
 */
export const getSessionCaip10s = (
	session: NonNullable<WalletConnectProvider["session"]>,
	namespace: string,
): string[] =>
	Object.values(session.namespaces)
		.flatMap((ns) => ns.accounts ?? [])
		.filter((account) => account.startsWith(`${namespace}:`));

/**
 * Unique addresses from CAIP-10 account strings (one entry per chain, so the
 * same address repeats — dedupe).
 */
export const getCaip10Addresses = (caip10s: string[]): string[] => [
	...new Set(
		caip10s
			.map((account) => account.split(":")[2])
			.filter((address): address is string => !!address),
	),
];

/**
 * Shared shape of the Polkadot/Solana WalletConnect account streams: no-op
 * unless the session carries the platform's namespace, then a cached
 * observable that rebuilds the account list from the session on
 * `session_update` / `accountsChanged`.
 *
 * AppKit's `getAccount(namespace).allAccounts` is always empty for namespaces
 * without a native AppKit adapter — the WalletConnect session is the source of
 * truth, hence the session-driven rebuild.
 */
export const getWalletConnectSessionAccounts$ = <
	TAccount extends BaseWalletAccount,
>(options: {
	wallet: WalletConnectWallet;
	platform: WalletPlatform;
	/** WalletConnect namespace, e.g. "polkadot" | "solana" | "eip155". */
	namespace: string;
	/** Cache key for {@link getCachedObservable$} — must be reconnect-safe. */
	cacheKey: string;
	/** Build the account list from the live session. */
	buildAccounts: (provider: WalletConnectProvider) => TAccount[];
}): Observable<TAccount[]> => {
	const { wallet, platform, namespace, cacheKey, buildAccounts } = options;
	const provider = wallet.appKit.getProvider(namespace);

	if (!wallet.platforms.includes(platform) || !provider?.session) return of([]);

	return getCachedObservable$(cacheKey, () =>
		new Observable<TAccount[]>((subscriber) => {
			subscriber.next(buildAccounts(provider));

			// Re-derive when the WalletConnect session's accounts change, mirroring
			// the injected paths' change subscriptions.
			const reemit = () => subscriber.next(buildAccounts(provider));
			provider.on("session_update", reemit);
			provider.on("accountsChanged", reemit);

			return () => {
				provider.off("session_update", reemit);
				provider.off("accountsChanged", reemit);
			};
		}).pipe(shareReplay({ refCount: true, bufferSize: 1 })),
	);
};
