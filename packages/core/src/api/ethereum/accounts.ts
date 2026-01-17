import type UniversalProvider from "@walletconnect/universal-provider";
import {
	combineLatest,
	distinctUntilChanged,
	map,
	Observable,
	of,
	ReplaySubject,
	shareReplay,
	switchMap,
} from "rxjs";
import {
	createWalletClient,
	custom,
	type EIP1193Provider,
	getAddress,
} from "viem";
import type {
	EthereumAccount,
	EthereumAppKitWallet,
	EthereumInjectedWallet,
	EthereumWallet,
} from "@/api/types";
import { getWalletAccountId } from "@/utils";
import { getCachedObservable$ } from "@/utils/getCachedObservable";

const getInjectedWalletAccounts$ = (
	wallet: EthereumInjectedWallet,
): Observable<EthereumAccount[]> => {
	if (!wallet.isConnected) return of([]);

	return getCachedObservable$(`accounts:${wallet.id}`, () =>
		new Observable<EthereumAccount[]>((subscriber) => {
			const getAccount = (address: string, i: number): EthereumAccount => {
				// console.log("[Injected] createWalletClient", address);
				const client = createWalletClient({
					account: address as `0x${string}`,
					transport: custom(wallet.provider as EIP1193Provider),
				});

				return {
					id: getWalletAccountId(wallet.id, address),
					platform: "ethereum",
					client,
					address: getAddress(address),
					walletName: wallet.name,
					walletId: wallet.id,
					isWalletDefault: i === 0,
				};
			};

			const handleAccountsChanged = (addresses: string[]) => {
				subscriber.next(addresses.map(getAccount));
			};

			// subscribe to changes
			wallet.provider.on("accountsChanged", handleAccountsChanged);

			// initial value
			wallet.provider
				.request({ method: "eth_accounts" })
				.then((addresses: string[]) => {
					subscriber.next(addresses.map(getAccount));
				})
				.catch((err) => {
					console.error("Failed to get accounts", err);
					subscriber.next([]);
				});

			return () => {
				wallet.provider.removeListener(
					"accountsChanged",
					handleAccountsChanged,
				);
			};
		}).pipe(shareReplay({ refCount: true, bufferSize: 1 })),
	);
};

const wrapWalletConnectProvider = (
	provider: EIP1193Provider,
	sessionTopic: string,
	caipNetworkId: string,
): EIP1193Provider => {
	return new Proxy(provider, {
		get(target, prop, receiver) {
			if (prop !== "request") return Reflect.get(target, prop, receiver);

			// biome-ignore lint/suspicious/noExplicitAny: legacy
			return (args: any) => {
				if (args && typeof args === "object" && args.method) {
					if (!args.topic) args.topic = sessionTopic;
					if (!args.chainId) args.chainId = caipNetworkId;
				}
				return target.request(args);
			};
		},
	});
};

const getAppKitAccounts$ = (
	wallet: EthereumAppKitWallet,
): Observable<EthereumAccount[]> => {
	const account = wallet.appKit.getAccount("eip155");
	const provider = wallet.appKit.getProvider<UniversalProvider>("eip155");

	if (
		!wallet.isConnected ||
		!wallet.appKit ||
		!account?.allAccounts.length ||
		!provider?.session
	)
		return of([]);

	return getCachedObservable$("accounts:appKit", () =>
		new Observable<EthereumAccount[]>((subscriber) => {
			const caipNetworkId$ = new ReplaySubject<string>(1);

			const handleChainChanged = (chainId: unknown) => {
				caipNetworkId$.next(`eip155:${chainId}`);
			};

			provider.on("chainChanged", handleChainChanged);
			provider.request({ method: "eth_chainId" }).then(handleChainChanged);

			const sub = caipNetworkId$
				.pipe(
					distinctUntilChanged(),
					map((caipNetworkId) =>
						custom(
							wrapWalletConnectProvider(
								provider as EIP1193Provider,
								// biome-ignore lint/style/noNonNullAssertion: legacy
								provider.session!.topic,
								caipNetworkId,
							),
						),
					),
					map((transport) =>
						account.allAccounts.map((acc, i): EthereumAccount => {
							// console.log("[AppKit] createWalletClient", acc);
							const client = createWalletClient({
								account: acc.address as `0x${string}`,
								transport,
							});

							return {
								id: getWalletAccountId(wallet.id, acc.address),
								platform: "ethereum",
								walletName: wallet.name,
								walletId: wallet.id,
								address: acc.address as `0x${string}`,
								client,
								isWalletDefault: i === 0,
							};
						}),
					),
				)
				.subscribe(subscriber);

			return () => {
				provider.off("chainChanged", handleChainChanged);
				sub.unsubscribe();
			};
		}).pipe(shareReplay({ refCount: true, bufferSize: 1 })),
	);
};

export const getEthereumAccounts$ = (
	ethereumWallets: Observable<EthereumWallet[]>,
) =>
	new Observable<EthereumAccount[]>((subscriber) => {
		const sub = ethereumWallets
			.pipe(
				map((wallets) => wallets.filter((w) => w.isConnected)),
				switchMap((wallets) => {
					return wallets.length
						? combineLatest([
								...wallets
									.filter((w) => w.type === "injected")
									.map(getInjectedWalletAccounts$),
								...wallets
									.filter((w) => w.type === "appKit")
									.map(getAppKitAccounts$),
								// todo appkit
							])
						: of([]);
				}),
				map((accounts) => accounts.flat()),
				distinctUntilChanged(isSameAccountsList),
			)
			.subscribe(subscriber);

		return () => {
			sub.unsubscribe();
		};
	}).pipe(
		// logObservable("ethereumAccounts$", true),
		shareReplay({ refCount: true, bufferSize: 1 }),
	);

const isSameAccountsList = (a: EthereumAccount[], b: EthereumAccount[]) => {
	if (a.length !== b.length) return false;
	return a.every((account, i) => account.id === b[i]?.id);
};
