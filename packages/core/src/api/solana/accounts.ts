import type { StandardEventsFeature } from "@wallet-standard/features";
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
import type { SolanaAppKitWallet } from "../types";
import { getSolanaChainIdFromCaip2, type SolanaChainId } from "./chains";
import {
	createInjectedSolanaSigner,
	createWalletConnectSolanaSigner,
} from "./signer";
import type {
	SolanaAccount,
	SolanaInjectedWallet,
	SolanaWallet,
} from "./types";

type StandardEventsApi = StandardEventsFeature["standard:events"];

const getInjectedWalletAccounts$ = (
	wallet: SolanaInjectedWallet,
	chain: SolanaChainId,
): Observable<SolanaAccount[]> => {
	if (!wallet.isConnected) return of([]);

	return getCachedObservable$(`accounts:${wallet.id}:${chain}`, () =>
		new Observable<SolanaAccount[]>((subscriber) => {
			const standardWallet = wallet.wallet;

			const buildAccounts = (): SolanaAccount[] =>
				standardWallet.accounts.map(
					(account): SolanaAccount => ({
						id: getWalletAccountId(wallet.id, account.address),
						platform: "solana",
						address: account.address,
						chains: wallet.chains,
						signer: createInjectedSolanaSigner(standardWallet, account, chain),
						getSigner: (c) =>
							createInjectedSolanaSigner(standardWallet, account, c),
						walletName: wallet.name,
						walletId: wallet.id,
					}),
				);

			subscriber.next(buildAccounts());

			// Re-emit when the wallet's authorized accounts change.
			const eventsFeature = (
				standardWallet.features as Record<string, unknown>
			)["standard:events"] as StandardEventsApi | undefined;
			const off = eventsFeature?.on("change", () =>
				subscriber.next(buildAccounts()),
			);

			return () => {
				off?.();
			};
		}).pipe(shareReplay({ refCount: true, bufferSize: 1 })),
	);
};

const getAppKitAccounts$ = (
	wallet: SolanaAppKitWallet,
	chain: SolanaChainId,
): Observable<SolanaAccount[]> => {
	const provider = wallet.appKit.getProvider("solana");

	if (!wallet.isConnected || !provider?.session) return of([]);

	return getCachedObservable$(`accounts:${wallet.id}:${chain}`, () =>
		new Observable<SolanaAccount[]>((subscriber) => {
			// AppKit has no native solana adapter, so getAccount("solana").allAccounts
			// is always empty; the WalletConnect session is the source of truth.
			// Accounts are CAIP-10 strings ("solana:<chainRef>:<address>"), one entry
			// per chain, so dedupe to unique addresses.
			const buildAccounts = (): SolanaAccount[] => {
				const session = provider.session;
				if (!session) return [];

				const solanaCaip10s = Object.values(session.namespaces)
					.flatMap((namespace) => namespace.accounts ?? [])
					.filter((account) => account.startsWith("solana:"));

				const addresses = [
					...new Set(
						solanaCaip10s
							.map((account) => account.split(":")[2])
							.filter((address): address is string => !!address),
					),
				];

				// Clusters the session actually advertises ("solana:<chainRef>" from
				// each CAIP-10 entry), mapped back to SolanaChainId. Falls back to the
				// configured chain when none are recognised.
				const advertisedChains = [
					...new Set(
						solanaCaip10s
							.map((account) => account.split(":").slice(0, 2).join(":"))
							.map(getSolanaChainIdFromCaip2)
							.filter((c): c is SolanaChainId => !!c),
					),
				];
				const chains = advertisedChains.length ? advertisedChains : [chain];

				return addresses.map(
					(accountAddress): SolanaAccount => ({
						id: getWalletAccountId(wallet.id, accountAddress),
						platform: "solana",
						address: accountAddress,
						chains,
						signer: createWalletConnectSolanaSigner(
							provider,
							accountAddress,
							chain,
						),
						getSigner: (c) =>
							createWalletConnectSolanaSigner(provider, accountAddress, c),
						walletName: wallet.name,
						walletId: wallet.id,
					}),
				);
			};

			subscriber.next(buildAccounts());

			// Re-derive when the WalletConnect session's accounts change, mirroring
			// the injected wallet's standard:events "change" subscription.
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

export const getSolanaAccounts$ = (
	solanaWallets$: Observable<SolanaWallet[]>,
	solanaChain: SolanaChainId,
) =>
	new Observable<SolanaAccount[]>((subscriber) => {
		const sub = solanaWallets$
			.pipe(
				map((wallets) => wallets.filter((w) => w.isConnected)),
				switchMap((wallets) =>
					wallets.length
						? combineLatest([
								...wallets
									.filter((w) => w.type === "injected")
									.map((w) => getInjectedWalletAccounts$(w, solanaChain)),
								...wallets
									.filter((w) => w.type === "appKit")
									.map((w) => getAppKitAccounts$(w, solanaChain)),
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

const isSameAccountsList = (a: SolanaAccount[], b: SolanaAccount[]) => {
	if (a.length !== b.length) return false;
	return a.every((account, i) => {
		const other = b[i];
		if (!other || account.id !== other.id) return false;
		// Re-emit when the advertised clusters change, not just on id changes.
		if (account.chains.length !== other.chains.length) return false;
		return account.chains.every((chain, j) => chain === other.chains[j]);
	});
};
