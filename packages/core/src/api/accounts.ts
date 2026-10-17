import { combineLatest, map, Observable, of, shareReplay } from "rxjs";
import { sortAccounts } from "../utils/sortAccounts";
import { framesOf, type PlatformAccountsFrame } from "./platformAccounts";
import type {
	BaseWallet,
	BaseWalletAccount,
	KheopskitConfig,
	WalletConnectWallet,
} from "./types";
import { isWalletConnectWallet } from "./types";

export type AccountsFrame = PlatformAccountsFrame<BaseWalletAccount>;

export const getAccounts$ = (
	config: KheopskitConfig,
	wallets: Observable<(BaseWallet | WalletConnectWallet)[]>,
) => {
	return new Observable<AccountsFrame>((subscriber) => {
		// Each plugin gets its own platform's (injected) wallets plus the shared
		// WalletConnect connector; it derives WC accounts only for the namespaces
		// the session carries.
		const sources = config.platforms.map((plugin) =>
			framesOf(
				plugin.getAccounts$(
					wallets.pipe(
						map((ws) =>
							ws.filter(
								(w) =>
									isWalletConnectWallet(w) || w.platform === plugin.platform,
							),
						),
					),
				),
			),
		);

		const frames$ = sources.length
			? combineLatest(sources).pipe(
					map((frames) => ({
						accounts: frames
							.flatMap((frame) => frame.accounts)
							.sort(sortAccounts),
						answered: frames.flatMap((frame) => frame.answered),
					})),
				)
			: of<AccountsFrame>({ accounts: [], answered: [] });

		const sub = frames$.subscribe(subscriber);

		return () => {
			sub.unsubscribe();
		};
	}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));
};
