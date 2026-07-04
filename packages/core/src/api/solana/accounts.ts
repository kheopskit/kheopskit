import type { StandardEventsFeature } from "@wallet-standard/features";
import { Observable, of, shareReplay } from "rxjs";
import { getWalletAccountId } from "../../utils";
import { getCachedObservable$ } from "../../utils/getCachedObservable";
import {
	createPlatformAccounts$,
	getCaip10Addresses,
	getSessionCaip10s,
	getWalletConnectSessionAccounts$,
} from "../platformAccounts";
import type { WalletConnectWallet } from "../types";
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

const getWalletConnectAccounts$ = (
	wallet: WalletConnectWallet,
	chain: SolanaChainId,
): Observable<SolanaAccount[]> =>
	getWalletConnectSessionAccounts$({
		wallet,
		platform: "solana",
		namespace: "solana",
		cacheKey: `accounts:${wallet.id}:solana:${chain}`,
		buildAccounts: (provider) => {
			const session = provider.session;
			if (!session) return [];

			const solanaCaip10s = getSessionCaip10s(session, "solana");
			const addresses = getCaip10Addresses(solanaCaip10s);

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
		},
	});

export const getSolanaAccounts$ = (
	solanaWallets$: Observable<(SolanaWallet | WalletConnectWallet)[]>,
	solanaChain: SolanaChainId,
) =>
	createPlatformAccounts$({
		wallets$: solanaWallets$,
		getInjectedAccounts$: (wallet) =>
			getInjectedWalletAccounts$(wallet, solanaChain),
		getWalletConnectAccounts$: (wallet) =>
			getWalletConnectAccounts$(wallet, solanaChain),
		// Re-emit when the advertised clusters change, not just on id changes.
		accountChangeKey: (account) => `${account.id}|${account.chains.join(",")}`,
	});
