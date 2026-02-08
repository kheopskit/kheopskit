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
import { logObservable } from "../utils/logObservable";
import { getAccounts$ } from "./accounts";
import { resolveConfig } from "./config";
import { createKheopskitStore } from "./store";
import type { KheopskitConfig, Wallet, WalletAccount } from "./types";
import { getWallets$ } from "./wallets";

const arraysEqual = (a: string[], b: string[]) =>
	a.length === b.length && a.every((v, i) => v === b[i]);

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
	const cachedWallets = cachedState.wallets.map(hydrateWallet);
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
		);

		// Apply hydration buffer to accounts
		const bufferedAccounts$ = createAccountHydrationBuffer(
			cachedAccounts,
			liveAccounts$,
			kc.hydrationGracePeriod,
			(a) => a.walletId,
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
				// Only cache connected wallets and their accounts
				const connectedWallets = wallets.items.filter((w) => w.isConnected);
				const connectedWalletIds = new Set(connectedWallets.map((w) => w.id));
				const relevantAccounts = accounts.items.filter((a) =>
					connectedWalletIds.has(a.walletId),
				);

				if (kc.debug) {
					console.debug("[kheopskit] persisting state snapshot:", {
						wallets: connectedWallets.length,
						accounts: relevantAccounts.length,
					});
				}

				store.setCachedState(
					connectedWallets.map(serializeWallet),
					relevantAccounts.map(serializeAccount),
				);
			});

		return () => {
			subscription.unsubscribe();
			persistSub.unsubscribe();
		};
	}).pipe(
		throttleTime(16, undefined, { leading: true, trailing: true }), // ~1 frame at 60fps
		logObservable("kheopskit$", { enabled: kc.debug, printValue: true }),
		shareReplay({ bufferSize: 1, refCount: true }),
	);
};
