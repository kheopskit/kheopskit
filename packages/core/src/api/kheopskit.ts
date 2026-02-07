import {
	combineLatest,
	map,
	Observable,
	shareReplay,
	throttleTime,
} from "rxjs";
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
};

export const getKheopskit$ = (
	config?: Partial<KheopskitConfig>,
	ssrCookies?: string,
) => {
	const kc = resolveConfig(config);
	const store = createKheopskitStore({ ssrCookies, storageKey: kc.storageKey });

	if (kc.debug) console.debug("[kheopskit] config", kc);

	// Warn about SSR environment without cookies
	if (kc.debug && typeof window === "undefined" && ssrCookies === undefined) {
		console.warn(
			"[kheopskit] Running on server without `ssrCookies`. " +
				"Wallet state will not be hydrated. Pass cookies for SSR support.",
		);
	}

	return new Observable<KheopskitState>((subscriber) => {
		const wallets$ = getWallets$(kc, store);

		const subscription = combineLatest({
			wallets: wallets$,
			accounts: getAccounts$(kc, wallets$),
		})
			.pipe(map(({ wallets, accounts }) => ({ config: kc, wallets, accounts })))
			.subscribe(subscriber);

		return () => {
			subscription.unsubscribe();
		};
	}).pipe(
		throttleTime(16, undefined, { leading: true, trailing: true }), // ~1 frame at 60fps
		logObservable("kheopskit$", { enabled: kc.debug, printValue: true }),
		shareReplay({ bufferSize: 1, refCount: true }),
	);
};
