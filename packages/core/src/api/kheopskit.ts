import {
	asapScheduler,
	combineLatest,
	concat,
	debounceTime,
	distinctUntilChanged,
	filter,
	ignoreElements,
	map,
	Observable,
	of,
	shareReplay,
	startWith,
	take,
	tap,
} from "rxjs";
import {
	createAccountHydrationBuffer,
	createHydrationBuffer,
} from "../utils/createHydrationBuffer";
import { serializeAccount, serializeWallet } from "../utils/hydrateState";
import { getCachedIcon, setCachedIcons } from "../utils/iconCache";
import { logObservable } from "../utils/logObservable";
import { createRegistryReads$ } from "../utils/registryReads";
import { sortAccounts } from "../utils/sortAccounts";
import { sortWallets } from "../utils/sortWallets";
import type { WalletId } from "../utils/WalletId";
import { type AccountsFrame, getAccounts$ } from "./accounts";
import { resolveConfig } from "./config";
import { abortedError, walletPendingError } from "./errors";
import { getHydratedSnapshot } from "./hydration";
import { createKheopskitStore } from "./store";
import type {
	BaseWallet,
	BaseWalletAccount,
	CachedAccount,
	CachedWallet,
	KheopskitConfig,
	KheopskitPlatform,
	KheopskitState,
	WalletConnectWallet,
} from "./types";
import { isInjectedWallet, isWalletConnectWallet } from "./types";
import { getWallets$ } from "./wallets";

export type { KheopskitConfig, KheopskitState } from "./types";

/** Options for {@link getKheopskit$}. */
export type GetKheopskitOptions = {
	/**
	 * Cookie string for SSR hydration. When provided, state is read from cookies
	 * instead of localStorage so the server can hydrate without a flash. Pass the
	 * request's `cookie` header.
	 */
	ssrCookies?: string;
	/**
	 * An existing store to reuse instead of creating one.
	 */
	store?: ReturnType<typeof createKheopskitStore>;
};

export const getKheopskit$ = <
	const P extends readonly KheopskitPlatform[] = readonly KheopskitPlatform[],
>(
	config?: Partial<KheopskitConfig<P>>,
	options: GetKheopskitOptions = {},
): Observable<KheopskitState<P>> => {
	const { ssrCookies, store: existingStore } = options;
	const kc = resolveConfig(config);
	const store =
		existingStore ??
		createKheopskitStore({ ssrCookies, storageKey: kc.storageKey });

	if (kc.debug) console.debug("[kheopskit] config", kc);

	// Warn about SSR environment without cookies
	if (kc.debug && typeof window === "undefined" && ssrCookies === undefined) {
		console.warn(
			"[kheopskit] Running on server without `ssrCookies`. " +
				"Wallet state will not be hydrated. Pass cookies for SSR support.",
		);
	}

	// Get cached state for hydration (same snapshot the React provider builds)
	const { wallets: cachedWallets, accounts: cachedAccounts } =
		getHydratedSnapshot(store, kc, { icons: true });

	if (kc.debug && cachedWallets.length > 0) {
		console.debug("[kheopskit] hydrating from cache:", {
			wallets: cachedWallets.length,
			accounts: cachedAccounts.length,
		});
	}

	return new Observable<KheopskitState>((subscriber) => {
		let latest: KheopskitState | undefined;
		let closed = false;
		const waiters = new Set<StateWaiter>();
		const liveWaiters = new Set<(state: KheopskitState | undefined) => void>();
		const wrapped = new WeakMap<
			BaseWallet | WalletConnectWallet,
			BaseWallet | WalletConnectWallet
		>();

		const abandon = (waiter: StateWaiter) => {
			waiters.delete(waiter);
			if (waiter.isConnected)
				waiter.reject(abortedError(waiter.walletId, "connect"));
			else waiter.resolve();
		};

		const settleIn = (waiter: StateWaiter, state: KheopskitState) => {
			const wallet = state.wallets.find((w) => w.id === waiter.walletId);
			if (!wallet || wallet.isConnected === waiter.isConnected) {
				waiters.delete(waiter);
				waiter.resolve();
			}
		};

		const supersede = (walletId: WalletId, isConnected: boolean) => {
			for (const waiter of waiters)
				if (waiter.walletId === walletId && waiter.isConnected !== isConnected)
					abandon(waiter);
		};

		const whenState = (walletId: WalletId, isConnected: boolean) =>
			new Promise<void>((resolve, reject) => {
				const waiter = { walletId, isConnected, resolve, reject };
				waiters.add(waiter);
				if (latest) settleIn(waiter, latest);
				if (closed && waiters.has(waiter)) abandon(waiter);
			});

		const whenLive = (walletId: WalletId, signal: AbortSignal | undefined) =>
			new Promise<BaseWallet | WalletConnectWallet>((resolve, reject) => {
				const settle = (finish: () => void) => {
					liveWaiters.delete(check);
					signal?.removeEventListener("abort", onAbort);
					finish();
				};
				const onAbort = () =>
					settle(() => reject(abortedError(walletId, "connect")));
				const check = (state: KheopskitState | undefined) => {
					if (!state) return onAbort();
					const live = state.wallets.find(
						(w) => w.id === walletId && !w.isPlaceholder,
					);
					if (live) settle(() => resolve(live));
					else if (!state.isHydrating)
						settle(() => reject(walletPendingError(walletId)));
				};
				if (closed || signal?.aborted) return onAbort();
				signal?.addEventListener("abort", onAbort, { once: true });
				liveWaiters.add(check);
				if (latest) check(latest);
			});

		const deferToLive = (
			placeholder: BaseWallet | WalletConnectWallet,
		): BaseWallet | WalletConnectWallet => ({
			...placeholder,
			connect: async (options) => {
				const live = await whenLive(placeholder.id, options?.signal);
				if (closed) throw abortedError(placeholder.id, "connect");
				await live.connect(options);
			},
		});

		const settleWithState = (
			wallet: BaseWallet | WalletConnectWallet,
		): BaseWallet | WalletConnectWallet => {
			const existing = wrapped.get(wallet);
			if (existing) return existing;
			if (wallet.isPlaceholder) {
				const deferred = deferToLive(wallet);
				wrapped.set(wallet, deferred);
				return deferred;
			}
			if (!isInjectedWallet(wallet)) return wallet;
			const settled: BaseWallet = {
				...wallet,
				connect: async (options) => {
					if (closed) throw abortedError(wallet.id, "connect");
					await wallet.connect(options);
					supersede(wallet.id, true);
					await whenState(wallet.id, true);
				},
				disconnect: async () => {
					if (closed) throw abortedError(wallet.id, "disconnect");
					await wallet.disconnect();
					supersede(wallet.id, false);
					await whenState(wallet.id, false);
				},
			};
			wrapped.set(wallet, settled);
			return settled;
		};

		const registryReads$ = createRegistryReads$().pipe(
			shareReplay({ bufferSize: 1, refCount: true }),
		);
		const liveWallets$ = getWallets$(kc, store, registryReads$);
		const accountFrames$ = getAccounts$(kc, liveWallets$);
		const liveAccounts$ = accountFrames$.pipe(
			map(({ accounts }) => accounts.map(asLive)),
		);

		const isDiscovering$ = concat(
			of(true),
			registryReads$.pipe(ignoreElements()),
			liveWallets$.pipe(
				take(1),
				map(() => false),
			),
		).pipe(shareReplay({ bufferSize: 1, refCount: true }));

		const hydrationSettled$ = combineLatest([
			liveWallets$,
			accountFrames$.pipe(startWith(noAnswerYet)),
			isDiscovering$,
			store.observable.pipe(
				map((s) => s.remembered ?? []),
				take(1),
			),
		]).pipe(
			map(([wallets, { accounts, answered }, isDiscovering, remembered]) =>
				cachedWallets.every((cached) => {
					const wallet = wallets.find((w) => w.id === cached.id);
					if (!wallet) return !isDiscovering;
					return (
						cached.status !== "connecting" ||
						reconnectSettled(cached, wallet, {
							accounts,
							answered,
							cachedAccounts,
							remembered,
						})
					);
				}),
			),
			debounceTime(0, asapScheduler),
			distinctUntilChanged(),
		);

		// Apply hydration buffer to wallets
		const bufferedWallets$ = createHydrationBuffer(
			cachedWallets,
			liveWallets$.pipe(map((wallets) => wallets.map(asLive))),
			kc.hydrationGracePeriod,
			kc.hydrationTimeout,
			(w) => w.id,
			hydrationSettled$,
			(live, cached) => {
				const status = sessionRestoring(live, cached)
					? "connecting"
					: live.status;
				return {
					...live,
					status,
					isConnected: status === "connected",
					icon: cached.icon || getCachedIcon(cached.id) || live.icon,
				};
			},
			// Transform cached-only items: add icon from localStorage cache
			(cached) => ({
				...cached,
				icon: cached.icon || getCachedIcon(cached.id) || "",
			}),
		);

		// Apply hydration buffer to accounts
		const bufferedAccounts$ = createAccountHydrationBuffer(
			cachedAccounts,
			liveAccounts$,
			kc.hydrationGracePeriod,
			kc.hydrationTimeout,
			(a) => a.walletId,
			hydrationSettled$,
		);

		// Share the buffered streams so the main and persistence subscriptions
		// below reuse a single hydration pipeline (timers, isHydrating state)
		// instead of running the buffering twice.
		const sharedWallets$ = bufferedWallets$.pipe(
			shareReplay({ bufferSize: 1, refCount: true }),
		);
		const sharedAccounts$ = bufferedAccounts$.pipe(
			shareReplay({ bufferSize: 1, refCount: true }),
		);

		// Combine buffered wallets and accounts
		const subscription = combineLatest({
			wallets: sharedWallets$,
			accounts: sharedAccounts$,
			isDiscovering: isDiscovering$,
		})
			.pipe(
				map(({ wallets, accounts, isDiscovering }) => {
					if (kc.debug) {
						console.debug("[kheopskit] hydration state", {
							walletsHydrating: wallets.isHydrating,
							accountsHydrating: accounts.isHydrating,
							isDiscovering,
							walletsConnected: wallets.items.filter((w) => w.isConnected)
								.length,
							walletsTotal: wallets.items.length,
						});
					}
					// Sort on every emission with the same comparators used for the
					// cached initial snapshot. The hydration buffers append cached-only
					// items after live ones (and reconnects land out of order), so
					// without this the list visibly reorders as wallets come back.
					return {
						config: kc,
						wallets: [...wallets.items].sort(sortWallets).map(settleWithState),
						accounts: [...accounts.items].sort(sortAccounts),
						isHydrating: wallets.isHydrating || accounts.isHydrating,
						isDiscovering,
					};
				}),
				debounceTime(0, asapScheduler),
				distinctUntilChanged(statesEqual),
				tap((state) => {
					latest = state;
					for (const check of liveWaiters) check(state);
					for (const waiter of waiters) settleIn(waiter, state);
				}),
			)
			.subscribe(subscriber);

		// Persist state snapshot when hydration completes and state stabilizes
		const persistSub = combineLatest({
			wallets: sharedWallets$,
			accounts: sharedAccounts$,
		})
			.pipe(
				// Wait for hydration to complete
				filter(
					({ wallets, accounts }) =>
						!wallets.isHydrating && !accounts.isHydrating,
				),
				// Debounce to avoid excessive writes
				debounceTime(1000),
				// Only persist if the serialized snapshot would actually change.
				// Compare the persisted fields (not just ids): an Ethereum chain switch
				// keeps the same account id but changes the cached chainId, so an
				// id-only comparator would skip persisting it.
				distinctUntilChanged((prev, curr) => {
					const prevWalletKeys = prev.wallets.items.map(persistedWalletKey);
					const currWalletKeys = curr.wallets.items.map(persistedWalletKey);
					const prevAccountKeys = prev.accounts.items.map(accountChangeKey);
					const currAccountKeys = curr.accounts.items.map(accountChangeKey);
					return (
						arraysEqual(prevWalletKeys, currWalletKeys) &&
						arraysEqual(prevAccountKeys, currAccountKeys)
					);
				}),
			)
			.subscribe(({ wallets, accounts }) => {
				const snapshot = persistedSnapshot(
					wallets.items,
					accounts.items,
					store.getCachedState(),
				);

				if (kc.debug) {
					console.debug("[kheopskit] persisting state snapshot:", {
						wallets: snapshot.wallets.length,
						accounts: snapshot.accounts.length,
					});
				}

				store.setCachedState(snapshot.wallets, snapshot.accounts);

				// Cache wallet icons in localStorage (separate from cookies for size)
				const icons: Record<string, string> = {};
				for (const wallet of wallets.items) {
					if (wallet.icon) {
						icons[wallet.id] = wallet.icon;
					}
				}
				setCachedIcons(icons);
			});

		return () => {
			subscription.unsubscribe();
			persistSub.unsubscribe();
			closed = true;
			for (const waiter of waiters) abandon(waiter);
			for (const check of liveWaiters) check(undefined);
		};
	}).pipe(
		logObservable("kheopskit$", { enabled: kc.debug, printValue: true }),
		shareReplay({ bufferSize: 1, refCount: true }),
		// The runtime objects are the concrete per-plugin wallet/account types;
		// recover the precise KheopskitState<P> the caller's plugins imply.
	) as unknown as Observable<KheopskitState<P>>;
};

type StateWaiter = {
	walletId: WalletId;
	isConnected: boolean;
	resolve: () => void;
	reject: (error: unknown) => void;
};

// AppKit restores a cached WalletConnect session on its own and reports nothing
// until it has; an injected wallet reports its attempt from its first emission.
const sessionRestoring = (
	live: BaseWallet | WalletConnectWallet,
	cached: BaseWallet | WalletConnectWallet,
): boolean =>
	isWalletConnectWallet(live) &&
	live.status === "disconnected" &&
	cached.status === "connecting";

const flagged = new WeakMap<object, object>();

const asLive = <T extends object>(item: T): T & { isPlaceholder: false } => {
	const existing = flagged.get(item);
	if (existing) return existing as T & { isPlaceholder: false };
	const live = { ...item, isPlaceholder: false as const };
	flagged.set(item, live);
	return live;
};

const noAnswerYet: AccountsFrame = { accounts: [], answered: [] };

/**
 * A remembered wallet that reads disconnected without an error is still
 * waiting for its reconnect: getWallets$ emits the wallet list before its
 * connect() flips the status to connecting.
 */
const reconnectSettled = (
	cached: BaseWallet | WalletConnectWallet,
	wallet: BaseWallet | WalletConnectWallet,
	live: AccountsFrame & {
		cachedAccounts: BaseWalletAccount[];
		remembered: WalletId[];
	},
): boolean => {
	const status = sessionRestoring(wallet, cached)
		? "connecting"
		: wallet.status;
	if (status === "connecting") return false;
	if (status === "disconnected")
		return wallet.error !== undefined || !live.remembered.includes(cached.id);
	return (
		live.answered.includes(cached.id) ||
		!live.cachedAccounts.some((a) => a.walletId === cached.id) ||
		live.accounts.some((a) => a.walletId === cached.id)
	);
};

/**
 * A wallet still connecting keeps its previous cache entry and accounts:
 * written live it would read isConnected: false with no accounts, and the
 * next load would hydrate it as disconnected without placeholders while its
 * reconnect runs.
 */
const persistedSnapshot = (
	wallets: (BaseWallet | WalletConnectWallet)[],
	accounts: BaseWalletAccount[],
	previous: { wallets: CachedWallet[]; accounts: CachedAccount[] },
): { wallets: CachedWallet[]; accounts: CachedAccount[] } => {
	const connecting = new Set(
		wallets.filter((w) => w.status === "connecting").map((w) => w.id),
	);
	const connected = new Set(
		wallets.filter((w) => w.isConnected).map((w) => w.id),
	);
	const previousWallets = new Map(previous.wallets.map((w) => [w.id, w]));
	return {
		wallets: wallets.map(
			(w) =>
				(connecting.has(w.id) && previousWallets.get(w.id)) ||
				serializeWallet(w),
		),
		accounts: [
			...accounts
				.filter((a) => connected.has(a.walletId))
				.map(serializeAccount),
			...previous.accounts.filter((a) => connecting.has(a.walletId)),
		],
	};
};

const arraysEqual = (a: string[], b: string[]) =>
	a.length === b.length && a.every((v, i) => v === b[i]);

// Mutable per-platform account fields that can change without the account id
// changing. Declared locally (not imported from the platform packages) so this
// core entry stays free of platform SDK types — see check:isolation.
type EthereumAccountFields = { chainId?: number };
type PolkadotAccountFields = { type?: string };
type SolanaAccountFields = { chains?: string[] };

/**
 * A signature of an account covering its id, its name, plus the
 * platform-specific fields that can change without the id changing (Ethereum
 * chainId, Polkadot key type, Solana clusters). Used to detect both UI-relevant
 * changes and changes worth re-persisting, so the two comparators can't drift
 * apart.
 */
const accountChangeKey = (account: BaseWalletAccount): string =>
	`${account.name ?? ""}|${accountPlatformKey(account)}`;

const accountPlatformKey = (account: BaseWalletAccount): string => {
	switch (account.platform) {
		case "ethereum":
			return `${account.id}|${(account as EthereumAccountFields).chainId ?? ""}`;
		case "polkadot":
			return `${account.id}|${(account as PolkadotAccountFields).type ?? ""}`;
		case "solana":
			return `${account.id}|${((account as SolanaAccountFields).chains ?? []).join(",")}`;
		default:
			return account.id;
	}
};

/** Platforms a wallet's live session carries (only the WalletConnect connector). */
const walletPlatforms = (wallet: BaseWallet | WalletConnectWallet): string =>
	isWalletConnectWallet(wallet) ? wallet.platforms.join(",") : "";

/** Fields persisted to the cache for a wallet (icon is stored separately). */
const walletPersistKey = (wallet: BaseWallet | WalletConnectWallet): string =>
	`${wallet.id}|${wallet.isConnected ? 1 : 0}|${wallet.name}`;

/**
 * What decides a cache write: the persisted fields plus `status`, because a
 * wallet whose kept entry was written while connecting must be rewritten live
 * once its reconnect fails, and `isConnected` reads false on both sides.
 */
const persistedWalletKey = (wallet: BaseWallet | WalletConnectWallet): string =>
	`${walletPersistKey(wallet)}|${wallet.status}`;

/**
 * UI-significant signature of a wallet: the persisted fields plus icon and the
 * WalletConnect connector's `platforms` array, which drive what the UI shows but
 * aren't part of the id (icon and platforms can arrive asynchronously after
 * connect without isConnected flipping).
 */
const walletUiKey = (wallet: BaseWallet | WalletConnectWallet): string =>
	`${walletPersistKey(wallet)}|${wallet.status}|${wallet.error?.code ?? ""}|${wallet.icon}|${walletPlatforms(wallet)}`;

/**
 * Equality check for KheopskitState to prevent unnecessary emissions. Compares
 * the UI-significant signature of every wallet and account, in order.
 */
const statesEqual = (a: KheopskitState, b: KheopskitState): boolean =>
	a.isHydrating === b.isHydrating &&
	a.isDiscovering === b.isDiscovering &&
	a.wallets.length === b.wallets.length &&
	a.accounts.length === b.accounts.length &&
	a.wallets.every((w, i) => {
		const other = b.wallets[i];
		return (
			!!other &&
			w.isPlaceholder === other.isPlaceholder &&
			walletUiKey(w) === walletUiKey(other)
		);
	}) &&
	a.accounts.every((acc, i) => {
		const other = b.accounts[i];
		return (
			!!other &&
			acc.isPlaceholder === other.isPlaceholder &&
			accountChangeKey(acc) === accountChangeKey(other)
		);
	});
