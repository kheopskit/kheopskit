import { createAppKit } from "@reown/appkit/core";
import {
	BehaviorSubject,
	combineLatest,
	distinctUntilChanged,
	map,
	Observable,
	of,
	shareReplay,
} from "rxjs";
import { getWalletId } from "../utils/WalletId";
import type {
	EthereumAppKitWallet,
	KheopskitConfig,
	PolkadotAppKitWallet,
} from "./types";

const WALLET_CONNECT_ICON =
	"data:image/svg+xml;base64,PHN2ZyBmaWxsPSJub25lIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDQwMCA0MDAiIHdpZHRoPSI0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiPjxjbGlwUGF0aCBpZD0iYSI+PHBhdGggZD0ibTAgMGg0MDB2NDAwaC00MDB6Ii8+PC9jbGlwUGF0aD48ZyBjbGlwLXBhdGg9InVybCgjYSkiPjxjaXJjbGUgY3g9IjIwMCIgY3k9IjIwMCIgZmlsbD0iIzMzOTZmZiIgcj0iMTk5LjUiIHN0cm9rZT0iIzY2YjFmZiIvPjxwYXRoIGQ9Im0xMjIuNTE5IDE0OC45NjVjNDIuNzkxLTQxLjcyOSAxMTIuMTcxLTQxLjcyOSAxNTQuOTYyIDBsNS4xNSA1LjAyMmMyLjE0IDIuMDg2IDIuMTQgNS40NjkgMCA3LjU1NWwtMTcuNjE3IDE3LjE4Yy0xLjA3IDEuMDQzLTIuODA0IDEuMDQzLTMuODc0IDBsLTcuMDg3LTYuOTExYy0yOS44NTMtMjkuMTExLTc4LjI1My0yOS4xMTEtMTA4LjEwNiAwbC03LjU5IDcuNDAxYy0xLjA3IDEuMDQzLTIuODA0IDEuMDQzLTMuODc0IDBsLTE3LjYxNy0xNy4xOGMtMi4xNC0yLjA4Ni0yLjE0LTUuNDY5IDAtNy41NTV6bTE5MS4zOTcgMzUuNTI5IDE1LjY3OSAxNS4yOWMyLjE0IDIuMDg2IDIuMTQgNS40NjkgMCA3LjU1NWwtNzAuNyA2OC45NDRjLTIuMTM5IDIuMDg3LTUuNjA4IDIuMDg3LTcuNzQ4IDBsLTUwLjE3OC00OC45MzFjLS41MzUtLjUyMi0xLjQwMi0uNTIyLTEuOTM3IDBsLTUwLjE3OCA0OC45MzFjLTIuMTM5IDIuMDg3LTUuNjA4IDIuMDg3LTcuNzQ4IDBsLTcwLjcwMTUtNjguOTQ1Yy0yLjEzOTYtMi4wODYtMi4xMzk2LTUuNDY5IDAtNy41NTVsMTUuNjc5NS0xNS4yOWMyLjEzOTYtMi4wODYgNS42MDg1LTIuMDg2IDcuNzQ4MSAwbDUwLjE3ODkgNDguOTMyYy41MzUuNTIyIDEuNDAyLjUyMiAxLjkzNyAwbDUwLjE3Ny00OC45MzJjMi4xMzktMi4wODcgNS42MDgtMi4wODcgNy43NDggMGw1MC4xNzkgNDguOTMyYy41MzUuNTIyIDEuNDAyLjUyMiAxLjkzNyAwbDUwLjE3OS00OC45MzFjMi4xMzktMi4wODcgNS42MDgtMi4wODcgNy43NDggMHoiIGZpbGw9IiNmZmYiLz48L2c+PC9zdmc+";

type AppKitWallets = {
	polkadot?: PolkadotAppKitWallet;
	ethereum?: EthereumAppKitWallet;
};

// once it exists, appKit object should never be recreated
let cachedAppKit: Observable<AppKitWallets> | null = null;

export const getAppKitWallets$ = (
	config: KheopskitConfig,
): Observable<AppKitWallets> => {
	if (!config.walletConnect) return of({});

	const walletConnect = config.walletConnect;

	if (!cachedAppKit) {
		cachedAppKit = new Observable<AppKitWallets>((subscriber) => {
			const appKit = createAppKit({
				projectId: walletConnect.projectId,
				metadata: walletConnect.metadata,
				networks: walletConnect.networks,
				themeMode: walletConnect.themeMode,
				themeVariables: walletConnect.themeVariables,
				universalProviderConfigOverride: {
					methods: {
						polkadot: ["polkadot_signTransaction", "polkadot_signMessage"],
					},
				},
				allWallets: "HIDE",
				debug: config.debug,
				allowUnsupportedChain: true,
			});

			const status$ = new BehaviorSubject({
				isPolkadotConnected: false,
				isEthereumConnected: false,
			});

			const unsubProviders = appKit.subscribeProviders((providers) => {
				status$.next({
					isPolkadotConnected: !!providers.polkadot,
					isEthereumConnected: !!providers.eip155,
				});
			});

			const polkadotWallet$ = appKit.chainNamespaces.includes("polkadot")
				? status$.pipe(
						map((s) => s.isPolkadotConnected),
						distinctUntilChanged(),
						map((isConnected): PolkadotAppKitWallet => {
							const walletInfo = appKit.getWalletInfo();

							return {
								id: getWalletId("polkadot", "walletconnect"),
								platform: "polkadot",
								type: "appKit",
								appKit, // todo maybe we dont want to expose the appKit instance
								name: walletInfo?.name ?? "WalletConnect",
								icon: walletInfo?.icon ?? WALLET_CONNECT_ICON,
								connect: async () => {
									if (!isConnected) await appKit.open();
								},
								disconnect: () => {
									if (isConnected) appKit.disconnect();
								},
								isConnected,
							};
						}),
					)
				: of(undefined);

			const ethereumWallet$ = appKit.chainNamespaces.includes("eip155")
				? status$.pipe(
						map((s) => s.isEthereumConnected),
						distinctUntilChanged(),
						map((isConnected): EthereumAppKitWallet => {
							const walletInfo = appKit.getWalletInfo();

							return {
								id: getWalletId("ethereum", "walletconnect"),
								platform: "ethereum",
								type: "appKit",
								appKit,
								name: walletInfo?.name ?? "WalletConnect",
								icon: walletInfo?.icon ?? WALLET_CONNECT_ICON,
								connect: () => appKit.open(),
								disconnect: () => appKit.disconnect(),
								isConnected,
							};
						}),
					)
				: of(undefined);

			const sub = combineLatest({
				polkadot: polkadotWallet$,
				ethereum: ethereumWallet$,
			}).subscribe(subscriber);

			return () => {
				sub.unsubscribe();
				unsubProviders();
			};
		}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));
	}

	return cachedAppKit;
};
