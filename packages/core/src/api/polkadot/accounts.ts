import type { AppKit } from "@reown/appkit/core";
import type UniversalProvider from "@walletconnect/universal-provider";
import {
	getPolkadotSignerFromPjs,
	type InjectedExtension,
	type InjectedPolkadotAccount,
} from "polkadot-api/pjs-signer";
import {
	combineLatest,
	distinctUntilChanged,
	map,
	Observable,
	of,
	shareReplay,
	switchMap,
} from "rxjs";
import type {
	PolkadotAccount,
	PolkadotAppKitWallet,
	PolkadotInjectedWallet,
	PolkadotWallet,
} from "../types";
import { getWalletAccountId } from "../../utils";

const getInjectedWalletAccounts$ = (
	wallet: PolkadotInjectedWallet,
): Observable<PolkadotAccount[]> => {
	if (!wallet.isConnected) return of([]);

	return new Observable<PolkadotAccount[]>((subscriber) => {
		const getAccount = (account: InjectedPolkadotAccount): PolkadotAccount => ({
			id: getWalletAccountId(wallet.id, account.address),
			...account,
			platform: "polkadot",
			walletName: wallet.name,
			walletId: wallet.id,
		});

		const extension = wallet.extension as InjectedExtension;

		// subscribe to changes
		const unsubscribe = extension.subscribe((accounts) => {
			subscriber.next(accounts.map(getAccount));
		});

		// initial value
		subscriber.next(extension.getAccounts().map(getAccount));

		return () => {
			return unsubscribe();
		};
	});
};

const getAppKitPolkadotSigner = (appKit: AppKit, address: string) => {
	const provider = appKit.getProvider<UniversalProvider>("polkadot");
	if (!provider) throw new Error("No provider found");
	if (!provider.session) throw new Error("No session found");

	return getPolkadotSignerFromPjs(
		address,
		(transactionPayload) => {
			if (!provider.session) throw new Error("No session found");

			return provider.client.request({
				topic: provider.session.topic,
				chainId: `polkadot:${transactionPayload.genesisHash.substring(2, 34)}`,
				request: {
					method: "polkadot_signTransaction",
					params: {
						address,
						transactionPayload,
					},
				},
			});
		},
		async ({ address, data }) => {
			if (!provider.session) throw new Error("No session found");
			const networks = appKit.getCaipNetworks("polkadot");
			const chainId = networks[0]?.caipNetworkId;
			if (!chainId) throw new Error("No chainId found");

			return provider.client.request({
				topic: provider.session.topic,
				chainId,
				request: {
					method: "polkadot_signMessage",
					params: {
						address,
						message: data,
					},
				},
			});
		},
	);
};

const getAppKitAccounts$ = (wallet: PolkadotAppKitWallet) => {
	const account = wallet.appKit.getAccount("polkadot");
	const provider = wallet.appKit.getProvider<UniversalProvider>("polkadot");

	if (
		!wallet.isConnected ||
		!wallet.appKit ||
		!account?.allAccounts.length ||
		!provider?.session
	)
		return of([]);

	return of(
		account.allAccounts.map(
			(acc): PolkadotAccount => ({
				id: getWalletAccountId(wallet.id, acc.address),
				platform: "polkadot",
				walletName: wallet.name,
				walletId: wallet.id,
				address: acc.address,
				polkadotSigner: getAppKitPolkadotSigner(wallet.appKit, acc.address),
				genesisHash: null,
				name: `${wallet.name} Polkadot`,
				type: "sr25519",
			}),
		),
	);
};

export const getPolkadotAccounts$ = (
	polkadotWallets$: Observable<PolkadotWallet[]>,
) =>
	new Observable<PolkadotAccount[]>((subscriber) => {
		const sub = polkadotWallets$
			.pipe(
				map((wallets) => wallets.filter((w) => w.isConnected)),
				switchMap((wallets) =>
					wallets.length
						? combineLatest([
								...wallets
									.filter((w) => w.type === "injected")
									.map(getInjectedWalletAccounts$),
								...wallets
									.filter((w) => w.type === "appKit")
									.map(getAppKitAccounts$),
							])
						: of([]),
				),
				map((accounts) => accounts.flat()),
				distinctUntilChanged(isSameAccountsList),
			)
			.subscribe(subscriber);

		return () => {
			sub.unsubscribe();
		};
	}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));

const isSameAccountsList = (a: PolkadotAccount[], b: PolkadotAccount[]) => {
	if (a.length !== b.length) return false;
	return a.every((account, i) => account.id === b[i]?.id);
};
