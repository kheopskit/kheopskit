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
import { getAccounts$ } from "./accounts";
import { resolveConfig } from "./config";
import { createKheopskitStore } from "./store";
import type { KheopskitConfig, Wallet, WalletAccount } from "./types";
import { getWallets$ } from "./wallets";

export type { KheopskitConfig } from "./types";

export type KheopskitState = {
	wallets: Wallet[];
	accounts: WalletAccount[];
	config: KheopskitConfig;
	/**
	 * Whether the state is still being hydrated from cache.
	 * During hydration, cached wallets/accounts may be displayed
	 * before the actual wallet extensions have injected.
	 *
	 * Use this to show loading indicators or disable certain actions.
	 */
	isHydrating: boolean;
};

export const getKheopskit$ = (
	config?: Partial<KheopskitConfig>,
	ssrCookies?: string,
	existingStore?: ReturnType<typeof createKheopskitStore>,
) => {
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
	const cachedAccounts = cachedState.accounts.map(hydrateAccount);

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

		// Combine buffered wallets and accounts
		const subscription = combineLatest({
			wallets: bufferedWallets$,
			accounts: bufferedAccounts$,
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
					return {
						config: kc,
						wallets: wallets.items,
						accounts: accounts.items,
						isHydrating: wallets.isHydrating || accounts.isHydrating,
					};
				}),
			)
			.subscribe(subscriber);

		// Persist state snapshot when hydration completes and state stabilizes
		const persistSub = combineLatest({
			wallets: bufferedWallets$,
			accounts: bufferedAccounts$,
		})
			.pipe(
				// Wait for hydration to complete
				filter(
					({ wallets, accounts }) =>
						!wallets.isHydrating && !accounts.isHydrating,
				),
				// Debounce to avoid excessive writes
				debounceTime(1000),
				// Only persist if state actually changed
				distinctUntilChanged((prev, curr) => {
					const prevWalletIds = prev.wallets.items.map((w) => w.id);
					const currWalletIds = curr.wallets.items.map((w) => w.id);
					const prevAccountIds = prev.accounts.items.map((a) => a.id);
					const currAccountIds = curr.accounts.items.map((a) => a.id);
					return (
						arraysEqual(prevWalletIds, currWalletIds) &&
						arraysEqual(prevAccountIds, currAccountIds)
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
	);
};

const arraysEqual = (a: string[], b: string[]) =>
	a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Deep equality check for KheopskitState to prevent unnecessary emissions.
 */
const statesEqual = (a: KheopskitState, b: KheopskitState): boolean =>
	a.isHydrating === b.isHydrating &&
	a.wallets.length === b.wallets.length &&
	a.accounts.length === b.accounts.length &&
	a.wallets.every(
		(w, i) =>
			w.id === b.wallets[i]?.id && w.isConnected === b.wallets[i]?.isConnected,
	) &&
	a.accounts.every(
		(acc, i) =>
			acc.id === b.accounts[i]?.id &&
			(acc.platform !== "ethereum" ||
				(acc as { chainId?: number }).chainId ===
					(b.accounts[i] as { chainId?: number })?.chainId),
	);
