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

/** The account list plus the connected wallets whose stream has answered, an empty list included. */
export type PlatformAccountsFrame<TAccount> = {
	accounts: TAccount[];
	answered: WalletId[];
};

export type PlatformAccounts$<TAccount> = Observable<TAccount[]> & {
	frames$: Observable<PlatformAccountsFrame<TAccount>>;
};

const isPlatformAccounts$ = <TAccount extends BaseWalletAccount>(
	accounts$: Observable<TAccount[]>,
): accounts$ is PlatformAccounts$<TAccount> => "frames$" in accounts$;

/** A plugin not built on `createPlatformAccounts$` reports no answered wallet. */
export const framesOf = <TAccount extends BaseWalletAccount>(
	accounts$: Observable<TAccount[]>,
): Observable<PlatformAccountsFrame<TAccount>> =>
	isPlatformAccounts$(accounts$)
		? accounts$.frames$
		: accounts$.pipe(map((accounts) => ({ accounts, answered: [] })));

const idsEqual = (a: WalletId[], b: WalletId[]) =>
	a.length === b.length && a.every((id, i) => id === b[i]);

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
}: PlatformAccountsOptions<TWallet, TAccount>): PlatformAccounts$<TAccount> => {
	type Frame = PlatformAccountsFrame<TAccount>;
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

	const frames$ = new Observable<Frame>((subscriber) => {
		const connections = new Map<WalletId, WalletConnection<TAccount>>();
		let connectedIds: WalletId[] = [];
		let walletsCompleted = false;
		let emitted = false;

		const awaitingFirstAnswers = () =>
			!emitted &&
			[...connections.values()].some((connection) => !connection.answered);

		const accountsListed = () =>
			connectedIds.flatMap((id) => connections.get(id)?.accounts ?? []);
		const walletsAnswered = () =>
			connectedIds.filter((id) => connections.get(id)?.answered);

		const emit = () => {
			if (awaitingFirstAnswers()) return;
			emitted = true;
			subscriber.next({
				accounts: accountsListed(),
				answered: walletsAnswered(),
			});
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
						error: (error) => {
							console.warn(
								`[kheopskit] Could not list the accounts of ${wallet.id}`,
								error,
							);
							connection.accounts = [];
							connection.answered = true;
							connection.completed = true;
							emit();
							completeIfDone();
						},
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
		map((frame) =>
			mapAccounts ? { ...frame, accounts: mapAccounts(frame.accounts) } : frame,
		),
		distinctUntilChanged(
			(a, b) =>
				accountsListEqual(a.accounts, b.accounts) &&
				idsEqual(a.answered, b.answered),
		),
		shareReplay({ refCount: true, bufferSize: 1 }),
	);
	const accounts$ = frames$.pipe(
		map((frame) => frame.accounts),
		distinctUntilChanged(accountsListEqual),
		shareReplay({ refCount: true, bufferSize: 1 }),
	);
	return Object.assign(accounts$, { frames$ });
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
