import {
	distinctUntilChanged,
	map,
	Observable,
	of,
	Subscription,
	shareReplay,
} from "rxjs";
import { getCachedObservable$ } from "../utils/getCachedObservable";
import type { WalletId } from "../utils/WalletId";
import type {
	BaseWallet,
	BaseWalletAccount,
	WalletConnectProvider,
	WalletConnectWallet,
	WalletPlatform,
} from "./types";
import { isWalletConnectWallet } from "./types";

export type LiveWalletConnectWallet = Exclude<
	WalletConnectWallet,
	{ isPlaceholder: true }
>;

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
		wallet: LiveWalletConnectWallet,
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

type WalletConnection<TAccount> = {
	key: string;
	accounts: TAccount[];
	answered: boolean;
	completed: boolean;
	subscription: Subscription;
};

const sessionKey = (wallet: WalletConnectWallet): string =>
	`${wallet.id}|${wallet.platforms.join(",")}`;

const connectionKey = (wallet: BaseWallet | WalletConnectWallet): string =>
	isWalletConnectWallet(wallet) ? sessionKey(wallet) : wallet.id;

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
	const nameAndChangeKey = (account: TAccount) =>
		`${account.name ?? ""}|${accountChangeKey(account)}`;
	const accountsListEqual = (a: TAccount[], b: TAccount[]) =>
		a.length === b.length &&
		a.every((account, i) => {
			const other = b[i];
			return !!other && nameAndChangeKey(account) === nameAndChangeKey(other);
		});
	const accountsOf = (wallet: TWallet | LiveWalletConnectWallet) =>
		isWalletConnectWallet(wallet)
			? getWalletConnectAccounts$(wallet)
			: getInjectedAccounts$(wallet);

	return new Observable<TAccount[]>((subscriber) => {
		const connections = new Map<WalletId, WalletConnection<TAccount>>();
		let connectedIds: WalletId[] = [];
		let walletsCompleted = false;
		let emitted = false;

		const awaitingFirstAnswers = () =>
			!emitted &&
			[...connections.values()].some((connection) => !connection.answered);

		const emit = () => {
			if (awaitingFirstAnswers()) return;
			emitted = true;
			subscriber.next(
				connectedIds.flatMap((id) => connections.get(id)?.accounts ?? []),
			);
		};

		const completeIfDone = () => {
			if (
				walletsCompleted &&
				[...connections.values()].every((connection) => connection.completed)
			)
				subscriber.complete();
		};

		const reconcile = (wallets: (TWallet | WalletConnectWallet)[]) => {
			const connected = wallets.filter(
				(wallet): wallet is TWallet | LiveWalletConnectWallet =>
					wallet.isConnected && !wallet.isPlaceholder,
			);
			const keys = new Map(
				connected.map((w) => [w.id, connectionKey(w)] as const),
			);
			for (const [id, connection] of connections) {
				if (keys.get(id) === connection.key) continue;
				connection.subscription.unsubscribe();
				connections.delete(id);
			}
			connectedIds = connected.map((wallet) => wallet.id);
			const opened = connected
				.filter((wallet) => !connections.has(wallet.id))
				.map((wallet) => {
					const connection: WalletConnection<TAccount> = {
						key: connectionKey(wallet),
						accounts: [],
						answered: false,
						completed: false,
						subscription: new Subscription(),
					};
					connections.set(wallet.id, connection);
					return { wallet, connection };
				});
			for (const { wallet, connection } of opened) {
				connection.subscription.add(
					accountsOf(wallet).subscribe({
						next: (accounts) => {
							connection.accounts = accounts;
							connection.answered = true;
							emit();
						},
						error: (error) => subscriber.error(error),
						complete: () => {
							connection.completed = true;
							completeIfDone();
						},
					}),
				);
			}
			emit();
		};

		const sub = wallets$.subscribe({
			next: reconcile,
			error: (error) => subscriber.error(error),
			complete: () => {
				walletsCompleted = true;
				completeIfDone();
			},
		});

		return () => {
			sub.unsubscribe();
			for (const connection of connections.values())
				connection.subscription.unsubscribe();
		};
	}).pipe(
		map((accounts) => (mapAccounts ? mapAccounts(accounts) : accounts)),
		distinctUntilChanged(accountsListEqual),
		shareReplay({ refCount: true, bufferSize: 1 }),
	);
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
	wallet: LiveWalletConnectWallet;
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
