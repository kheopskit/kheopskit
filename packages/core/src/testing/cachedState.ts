import type { CachedAccount, CachedWallet, WalletPlatform } from "../api/types";

type InjectedWalletId = `${WalletPlatform}:${string}`;

type CachedInjectedWallet = CachedWallet & { platform: WalletPlatform };

/** A connected cached entry of an injected wallet for `store.setCachedState`. */
export const cachedWalletOf = (
	walletId: InjectedWalletId,
	name: string,
): CachedInjectedWallet => ({
	id: walletId,
	platform: walletId.slice(0, walletId.indexOf(":")) as WalletPlatform,
	type: "injected",
	name,
	isConnected: true,
});

/** A cached account entry of `wallet` for `store.setCachedState`. */
export const cachedAccountOf = (
	wallet: CachedInjectedWallet,
	address: string,
	name?: string,
): CachedAccount => ({
	id: `${wallet.id}::${address}`,
	platform: wallet.platform,
	address,
	...(name === undefined ? {} : { name }),
	walletId: wallet.id,
	walletName: wallet.name,
});
