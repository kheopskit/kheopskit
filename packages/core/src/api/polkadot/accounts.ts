import {
	getPolkadotSignerFromPjs,
	type InjectedExtension,
	type InjectedPolkadotAccount,
} from "polkadot-api/pjs-signer";
import { Observable, of } from "rxjs";
import { getWalletAccountId } from "../../utils";
import { KheopskitError } from "../errors";
import {
	createPlatformAccounts$,
	getCaip10Addresses,
	getSessionCaip10s,
	getWalletConnectSessionAccounts$,
} from "../platformAccounts";
import type {
	AppKitInstance,
	PolkadotAccountType,
	WalletConnectWallet,
} from "../types";
import type {
	PolkadotAccount,
	PolkadotInjectedWallet,
	PolkadotWallet,
} from "./types";

const getInjectedWalletAccounts$ = (
	wallet: PolkadotInjectedWallet,
): Observable<PolkadotAccount[]> => {
	if (!wallet.isConnected) return of([]);

	return new Observable<PolkadotAccount[]>((subscriber) => {
		const getAccount = (account: InjectedPolkadotAccount): PolkadotAccount => ({
			id: getWalletAccountId(wallet.id, account.address),
			...account,
			type: account.type ?? "sr25519",
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

const getAppKitPolkadotSigner = (appKit: AppKitInstance, address: string) => {
	const provider = appKit.getProvider("polkadot");
	if (!provider) throw new KheopskitError("NO_PROVIDER", "No provider found");
	if (!provider.session)
		throw new KheopskitError("NO_SESSION", "No session found");

	return getPolkadotSignerFromPjs(
		address,
		(transactionPayload) => {
			if (!provider.session)
				throw new KheopskitError("NO_SESSION", "No session found");

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
			if (!provider.session)
				throw new KheopskitError("NO_SESSION", "No session found");
			const networks = appKit.getCaipNetworks("polkadot");
			const chainId = networks[0]?.caipNetworkId;
			if (!chainId)
				throw new KheopskitError(
					"NO_SESSION",
					"No CAIP network available for polkadot",
				);

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

const getWalletConnectAccounts$ = (
	wallet: WalletConnectWallet,
): Observable<PolkadotAccount[]> =>
	getWalletConnectSessionAccounts$({
		wallet,
		platform: "polkadot",
		namespace: "polkadot",
		cacheKey: `accounts:${wallet.id}:polkadot:`,
		buildAccounts: (provider) => {
			const session = provider.session;
			if (!session) return [];

			const addresses = getCaip10Addresses(
				getSessionCaip10s(session, "polkadot"),
			);

			return addresses.map(
				(address): PolkadotAccount => ({
					id: getWalletAccountId(wallet.id, address),
					platform: "polkadot",
					walletName: wallet.name,
					walletId: wallet.id,
					address,
					polkadotSigner: getAppKitPolkadotSigner(wallet.appKit, address),
					genesisHash: null,
					name: `${wallet.name} Polkadot`,
					// WalletConnect (Reown AppKit) doesn't expose account key type;
					// default to sr25519, which is the most common Polkadot key type.
					type: "sr25519",
				}),
			);
		},
	});

export const getPolkadotAccounts$ = (
	polkadotWallets$: Observable<(PolkadotWallet | WalletConnectWallet)[]>,
	polkadotAccountTypes: PolkadotAccountType[],
) => {
	if (polkadotAccountTypes.length === 0) {
		console.warn(
			"[kheopskit] config.polkadotAccountTypes is empty; all Polkadot accounts will be filtered out.",
		);
	}

	return createPlatformAccounts$({
		wallets$: polkadotWallets$,
		getInjectedAccounts$: getInjectedWalletAccounts$,
		getWalletConnectAccounts$,
		mapAccounts: (accounts) =>
			accounts.filter((account) => polkadotAccountTypes.includes(account.type)),
	});
};
