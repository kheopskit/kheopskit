import {
	combineLatest,
	map,
	Observable,
	shareReplay,
	throttleTime,
} from "rxjs";
import { logObservable } from "@/utils/logObservable";
import { getAccounts$ } from "./accounts";
import { resolveConfig } from "./config";
import type { KheopskitConfig, Wallet, WalletAccount } from "./types";
import { getWallets$ } from "./wallets";

export type { KheopskitConfig } from "./types";

export type KheopskitState = {
	wallets: Wallet[];
	accounts: WalletAccount[];
	config: KheopskitConfig;
};

export const getKheopskit$ = (config?: Partial<KheopskitConfig>) => {
	const kc = resolveConfig(config);

	console.debug("[kheopskit] config", kc);

	return new Observable<KheopskitState>((subscriber) => {
		const wallets$ = getWallets$(kc);

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
