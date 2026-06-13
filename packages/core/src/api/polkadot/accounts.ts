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
import { getWalletAccountId } from "../../utils";
import { getCachedObservable$ } from "../../utils/getCachedObservable";
import { KheopskitError } from "../errors";
import type {
	AppKitInstance,
	PolkadotAccountType,
	PolkadotAppKitWallet,
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

const getAppKitAccounts$ = (
	wallet: PolkadotAppKitWallet,
): Observable<PolkadotAccount[]> => {
	const provider = wallet.appKit.getProvider("polkadot");

	if (!wallet.isConnected || !provider?.session) return of([]);

	return getCachedObservable$(`accounts:${wallet.id}`, () =>
		new Observable<PolkadotAccount[]>((subscriber) => {
			// AppKit's getAccount("polkadot").allAccounts is always empty because
			// AppKit has no native polkadot adapter; the WalletConnect session is the
			// source of truth. Accounts are CAIP-10 strings
			// ("polkadot:<chainRef>:<address>"), one entry per chain, so dedupe to
			// unique addresses.
			const buildAccounts = (): PolkadotAccount[] => {
				const session = provider.session;
				if (!session) return [];

				const addresses = [
					...new Set(
						Object.values(session.namespaces)
							.flatMap((namespace) => namespace.accounts ?? [])
							.filter((account) => account.startsWith("polkadot:"))
							.map((account) => account.split(":")[2])
							.filter((address): address is string => !!address),
					),
				];

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
			};

			subscriber.next(buildAccounts());

			// Re-derive when the WalletConnect session's accounts change, mirroring
			// the injected extension's subscribe and the Solana AppKit path.
			const reemit = () => subscriber.next(buildAccounts());
			provider.on("session_update", reemit);
			provider.on("accountsChanged", reemit);

			return () => {
				provider.off("session_update", reemit);
				provider.off("accountsChanged", reemit);
			};
		}).pipe(shareReplay({ refCount: true, bufferSize: 1 })),
	);
};

export const getPolkadotAccounts$ = (
	polkadotWallets$: Observable<PolkadotWallet[]>,
	polkadotAccountTypes: PolkadotAccountType[],
) =>
	new Observable<PolkadotAccount[]>((subscriber) => {
		if (polkadotAccountTypes.length === 0) {
			console.warn(
				"[kheopskit] config.polkadotAccountTypes is empty; all Polkadot accounts will be filtered out.",
			);
		}

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
				map((accounts) =>
					accounts
						.flat()
						.filter((account) => polkadotAccountTypes.includes(account.type)),
				),
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
