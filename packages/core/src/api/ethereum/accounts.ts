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
import { getWalletAccountId } from "../../utils";
import { getCachedObservable$ } from "../../utils/getCachedObservable";
import type {
	EthereumAccount,
	EthereumAppKitWallet,
	EthereumInjectedWallet,
	EthereumWallet,
} from "../types";

const normalizeEvmChainId = (value: unknown): number | undefined => {
	let raw = value;

	if (typeof raw === "string" && raw.startsWith("eip155:")) {
		raw = raw.slice("eip155:".length);
	}

	if (typeof raw === "bigint") {
		return raw >= 0n ? Number(raw) : undefined;
	}

	if (typeof raw === "number") {
		return Number.isInteger(raw) && raw >= 0 ? raw : undefined;
	}

	if (typeof raw === "string") {
		const normalized = raw.trim().toLowerCase();
		if (!normalized) return undefined;
		const parsed = normalized.startsWith("0x")
			? Number.parseInt(normalized, 16)
			: Number.parseInt(normalized, 10);
		return Number.isNaN(parsed) ? undefined : parsed;
	}

	return undefined;
};

const toCaipNetworkId = (value: unknown): string | undefined => {
	const chainId = normalizeEvmChainId(value);
	return chainId === undefined ? undefined : `eip155:${chainId}`;
};

const getInjectedWalletAccounts$ = (
	wallet: EthereumInjectedWallet,
): Observable<EthereumAccount[]> => {
	if (!wallet.isConnected) return of([]);

	return getCachedObservable$(`accounts:${wallet.id}`, () =>
		new Observable<EthereumAccount[]>((subscriber) => {
			const addresses$ = new ReplaySubject<string[]>(1);
			const chainId$ = new ReplaySubject<number | undefined>(1);

			const getAccount = (
				address: string,
				i: number,
				chainId: number | undefined,
			): EthereumAccount => {
				const client = createWalletClient({
					account: address as `0x${string}`,
					transport: custom(wallet.provider as EIP1193Provider),
				});

				return {
					id: getWalletAccountId(wallet.id, address),
					platform: "ethereum",
					client,
					address: getAddress(address),
					chainId,
					walletName: wallet.name,
					walletId: wallet.id,
					isWalletDefault: i === 0,
				};
			};

			const handleAccountsChanged = (addrs: string[]) => {
				addresses$.next(addrs);
			};

			const handleChainChanged = (chainIdHex: unknown) => {
				chainId$.next(normalizeEvmChainId(chainIdHex));
			};

			const handleDisconnect = () => {
				chainId$.next(undefined);
			};

			// Subscribe to provider events
			wallet.provider.on("accountsChanged", handleAccountsChanged);
			wallet.provider.on("chainChanged", handleChainChanged);
			wallet.provider.on("disconnect", handleDisconnect);

			// Fetch initial values
			wallet.provider
				.request({ method: "eth_accounts" })
				.then((addrs: string[]) => addresses$.next(addrs))
				.catch((err) => {
					console.error("Failed to get accounts", err);
					addresses$.next([]);
				});

			wallet.provider
				.request({ method: "eth_chainId" })
				.then(handleChainChanged)
				.catch(() => chainId$.next(undefined));

			// Combine addresses + chainId into account list
			const sub = combineLatest([addresses$, chainId$])
				.pipe(
					map(([addresses, chainId]) =>
						addresses.map((addr, i) => getAccount(addr, i, chainId)),
					),
				)
				.subscribe(subscriber);

			return () => {
				wallet.provider.removeListener(
					"accountsChanged",
					handleAccountsChanged,
				);
				wallet.provider.removeListener("chainChanged", handleChainChanged);
				wallet.provider.removeListener("disconnect", handleDisconnect);
				sub.unsubscribe();
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
				const caipNetworkId = toCaipNetworkId(chainId);
				if (caipNetworkId) {
					caipNetworkId$.next(caipNetworkId);
				}
			};

			provider.on("chainChanged", handleChainChanged);
			provider.request({ method: "eth_chainId" }).then(handleChainChanged);

			const sub = caipNetworkId$
				.pipe(
					distinctUntilChanged(),
					map((caipNetworkId) => {
						const chainId = normalizeEvmChainId(caipNetworkId);
						const transport = custom(
							wrapWalletConnectProvider(
								provider as EIP1193Provider,
								// biome-ignore lint/style/noNonNullAssertion: legacy
								provider.session!.topic,
								caipNetworkId,
							),
						);
						return { transport, chainId };
					}),
					map(({ transport, chainId }) =>
						account.allAccounts.map((acc, i): EthereumAccount => {
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
								chainId,
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
	return a.every(
		(account, i) =>
			account.id === b[i]?.id && account.chainId === b[i]?.chainId,
	);
};
