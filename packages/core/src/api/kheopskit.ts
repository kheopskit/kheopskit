import {
	combineLatest,
	debounceTime,
	distinctUntilChanged,
	filter,
	map,
	Observable,
	shareReplay,
	throttleTime,
} from "rxjs";
import {
	createAccountHydrationBuffer,
	createHydrationBuffer,
} from "../utils/createHydrationBuffer";
import {
	hydrateAccount,
	hydrateWallet,
	serializeAccount,
	serializeWallet,
} from "../utils/hydrateState";
import { getCachedIcon, setCachedIcons } from "../utils/iconCache";
import { logObservable } from "../utils/logObservable";
import { sortAccounts } from "../utils/sortAccounts";
import { sortWallets } from "../utils/sortWallets";
import { getAccounts$ } from "./accounts";
import { resolveConfig } from "./config";
import { acceptsCachedAccount } from "./platform";
import { createKheopskitStore } from "./store";
import type {
	BaseWallet,
	BaseWalletAccount,
	KheopskitConfig,
	KheopskitPlatform,
	KheopskitState,
	WalletConnectWallet,
} from "./types";
import { isWalletConnectWallet } from "./types";
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
	 * An existing store to reuse instead of creating one. Advanced escape hatch —
	 * most callers omit it. (`@kheopskit/react` passes its provider-scoped store.)
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

	// Get cached state for hydration
	const cachedState = store.getCachedState();
	// Hydrate wallets and enrich with icons from localStorage cache
	const cachedWallets = cachedState.wallets.map((w) => {
		const wallet = hydrateWallet(w);
		// If wallet doesn't have icon (e.g., Ethereum), try localStorage cache
		if (!wallet.icon) {
			const cachedIcon = getCachedIcon(wallet.id);
			if (cachedIcon) {
				return { ...wallet, icon: cachedIcon };
			}
		}
		return wallet;
	});
	const cachedAccounts = cachedState.accounts
		.filter((cached) => acceptsCachedAccount(cached, kc.platforms))
		.map(hydrateAccount);

	if (kc.debug && cachedWallets.length > 0) {
		console.debug("[kheopskit] hydrating from cache:", {
			wallets: cachedWallets.length,
			accounts: cachedAccounts.length,
		});
	}

	return new Observable<KheopskitState>((subscriber) => {
		// Get live wallets and accounts
		const liveWallets$ = getWallets$(kc, store);
		const liveAccounts$ = getAccounts$(kc, liveWallets$);

		// Apply hydration buffer to wallets
		const bufferedWallets$ = createHydrationBuffer(
			cachedWallets,
			liveWallets$,
			kc.hydrationGracePeriod,
			(w) => w.id,
			// Hydration converges when all cached-connected wallets are connected in live
			(liveWallets, cached) => {
				const cachedConnectedIds = new Set(
					cached.filter((w) => w.isConnected).map((w) => w.id),
				);
				if (cachedConnectedIds.size === 0) return true;
				return [...cachedConnectedIds].every((id) =>
					liveWallets.some((w) => w.id === id && w.isConnected),
				);
			},
			// Merge: prefer cached isConnected state but get icon from cache or live
			(live, cached) => ({
				...cached,
				// Priority: cached icon > localStorage cache > live icon
				icon: cached.icon || getCachedIcon(cached.id) || live.icon,
				// Use live wallet's connect/disconnect functions
				connect: live.connect,
				disconnect: live.disconnect,
			}),
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
			(a) => a.walletId,
			// Hydration converges when all wallets with cached accounts have provided live accounts
			(liveAccounts, cached) => {
				const cachedWalletIds = new Set(cached.map((a) => a.walletId));
				if (cachedWalletIds.size === 0) return true;
				const liveWalletIds = new Set(liveAccounts.map((a) => a.walletId));
				return [...cachedWalletIds].every((id) => liveWalletIds.has(id));
			},
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
		})
			.pipe(
				map(({ wallets, accounts }) => {
					if (kc.debug) {
						console.debug("[kheopskit] hydration state", {
							walletsHydrating: wallets.isHydrating,
							accountsHydrating: accounts.isHydrating,
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
						wallets: [...wallets.items].sort(sortWallets),
						accounts: [...accounts.items].sort(sortAccounts),
						isHydrating: wallets.isHydrating || accounts.isHydrating,
					};
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
					const prevWalletKeys = prev.wallets.items.map(walletPersistKey);
					const currWalletKeys = curr.wallets.items.map(walletPersistKey);
					const prevAccountKeys = prev.accounts.items.map(accountChangeKey);
					const currAccountKeys = curr.accounts.items.map(accountChangeKey);
					return (
						arraysEqual(prevWalletKeys, currWalletKeys) &&
						arraysEqual(prevAccountKeys, currAccountKeys)
					);
				}),
			)
			.subscribe(({ wallets, accounts }) => {
				// Cache ALL wallets to avoid wallet list flash on reload
				// Only accounts from connected wallets are cached
				const connectedWalletIds = new Set(
					wallets.items.filter((w) => w.isConnected).map((w) => w.id),
				);
				const relevantAccounts = accounts.items.filter((a) =>
					connectedWalletIds.has(a.walletId),
				);

				if (kc.debug) {
					console.debug("[kheopskit] persisting state snapshot:", {
						wallets: wallets.items.length,
						accounts: relevantAccounts.length,
					});
				}

				store.setCachedState(
					wallets.items.map(serializeWallet),
					relevantAccounts.map(serializeAccount),
				);

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
		};
	}).pipe(
		distinctUntilChanged(statesEqual),
		throttleTime(16, undefined, { leading: true, trailing: true }), // ~1 frame at 60fps
		logObservable("kheopskit$", { enabled: kc.debug, printValue: true }),
		shareReplay({ bufferSize: 1, refCount: true }),
		// The runtime objects are the concrete per-plugin wallet/account types;
		// recover the precise KheopskitState<P> the caller's plugins imply.
	) as unknown as Observable<KheopskitState<P>>;
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
 * A signature of an account covering its id plus the platform-specific fields
 * that can change without the id changing (Ethereum chainId, Polkadot key type,
 * Solana clusters). Used to detect both UI-relevant changes and changes worth
 * re-persisting, so the two comparators can't drift apart.
 */
const accountChangeKey = (account: BaseWalletAccount): string => {
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
 * UI-significant signature of a wallet: the persisted fields plus icon and the
 * WalletConnect connector's `platforms` array, which drive what the UI shows but
 * aren't part of the id (icon and platforms can arrive asynchronously after
 * connect without isConnected flipping).
 */
const walletUiKey = (wallet: BaseWallet | WalletConnectWallet): string =>
	`${walletPersistKey(wallet)}|${wallet.icon}|${walletPlatforms(wallet)}`;

/**
 * Equality check for KheopskitState to prevent unnecessary emissions. Compares
 * the UI-significant signature of every wallet and account, in order.
 */
const statesEqual = (a: KheopskitState, b: KheopskitState): boolean =>
	a.isHydrating === b.isHydrating &&
	a.wallets.length === b.wallets.length &&
	a.accounts.length === b.accounts.length &&
	a.wallets.every((w, i) => {
		const other = b.wallets[i];
		return !!other && walletUiKey(w) === walletUiKey(other);
	}) &&
	a.accounts.every((acc, i) => {
		const other = b.accounts[i];
		return !!other && accountChangeKey(acc) === accountChangeKey(other);
	});
