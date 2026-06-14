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
import type { WalletConnectWallet } from "../types";
import { isWalletConnectWallet } from "../types";
import type {
	EthereumAccount,
	EthereumInjectedWallet,
	EthereumWallet,
} from "./types";

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
						addresses.map((addr) => getAccount(addr, chainId)),
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
	caipNetworkId: string | undefined,
): EIP1193Provider => {
	return new Proxy(provider, {
		get(target, prop, receiver) {
			if (prop !== "request") return Reflect.get(target, prop, receiver);

			// biome-ignore lint/suspicious/noExplicitAny: EIP-1193 request args
			return (args: any) => {
				if (!args || typeof args !== "object" || !args.method)
					return target.request(args);
				// Build a new object rather than mutating the caller's args: the
				// EIP-1193 request object is owned by viem and may be frozen or reused.
				const next = { ...args };
				if (next.topic === undefined) next.topic = sessionTopic;
				if (next.chainId === undefined && caipNetworkId !== undefined)
					next.chainId = caipNetworkId;
				return target.request(next);
			};
		},
	});
};

const sameAddresses = (a: string[], b: string[]) =>
	a.length === b.length && a.every((addr, i) => addr === b[i]);

const getWalletConnectAccounts$ = (
	wallet: WalletConnectWallet,
): Observable<EthereumAccount[]> => {
	const provider = wallet.appKit.getProvider("eip155");

	if (!wallet.platforms.includes("ethereum") || !provider?.session)
		return of([]);

	return getCachedObservable$(`accounts:${wallet.id}:ethereum:`, () =>
		new Observable<EthereumAccount[]>((subscriber) => {
			const caipNetworkId$ = new ReplaySubject<string | undefined>(1);
			const addresses$ = new ReplaySubject<string[]>(1);

			// AppKit's getAccount("eip155").allAccounts is empty because this AppKit
			// instance has no native eip155 adapter — eip155 runs through the
			// WalletConnect UniversalProvider, so the session is the source of truth
			// (mirrors the polkadot/solana AppKit paths). Accounts are CAIP-10 strings
			// ("eip155:<chainRef>:<address>"), one entry per chain, so dedupe to unique
			// addresses. Read live on each change so switching/adding accounts is
			// reflected.
			const readAddresses = (): string[] => {
				const session = provider.session;
				if (!session) return [];
				const addresses = new Set<string>();
				for (const namespace of Object.values(session.namespaces)) {
					for (const account of namespace.accounts ?? []) {
						if (!account.startsWith("eip155:")) continue;
						const raw = account.split(":")[2];
						if (!raw) continue;
						try {
							addresses.add(getAddress(raw));
						} catch {
							// skip malformed CAIP-10 address
						}
					}
				}
				return [...addresses];
			};

			// Derive the CAIP network id from the session's eip155 CAIP-10 accounts
			// ("eip155:<ref>:<addr>") as a synchronous fallback for eth_chainId.
			const readCaipNetworkId = (): string | undefined => {
				const session = provider.session;
				if (!session) return undefined;
				for (const namespace of Object.values(session.namespaces)) {
					for (const account of namespace.accounts ?? []) {
						if (!account.startsWith("eip155:")) continue;
						const ref = account.split(":")[1];
						if (ref) return `eip155:${ref}`;
					}
				}
				return undefined;
			};

			const handleChainChanged = (chainId: unknown) => {
				const caipNetworkId = toCaipNetworkId(chainId);
				if (caipNetworkId) {
					caipNetworkId$.next(caipNetworkId);
				}
			};

			const handleAccountsChanged = () => addresses$.next(readAddresses());

			provider.on("chainChanged", handleChainChanged);
			provider.on("accountsChanged", handleAccountsChanged);
			provider.on("session_update", handleAccountsChanged);
			// Seed the chain id from the session synchronously so the account list can
			// surface even if eth_chainId never resolves; eth_chainId then refines it.
			// Without this seed, combineLatest below never fires when eth_chainId
			// rejects or returns an unparseable value, and the accounts silently never
			// appear (the injected path seeds undefined on failure for the same reason).
			caipNetworkId$.next(readCaipNetworkId());
			provider
				.request({ method: "eth_chainId" })
				.then(handleChainChanged)
				.catch(() => {});
			addresses$.next(readAddresses());

			const sub = combineLatest([
				caipNetworkId$.pipe(distinctUntilChanged()),
				addresses$.pipe(distinctUntilChanged(sameAddresses)),
			])
				.pipe(
					map(([caipNetworkId, addresses]) => {
						const chainId = normalizeEvmChainId(caipNetworkId);
						const transport = custom(
							wrapWalletConnectProvider(
								provider as unknown as EIP1193Provider,
								// biome-ignore lint/style/noNonNullAssertion: legacy
								provider.session!.topic,
								caipNetworkId,
							),
						);
						return addresses.map((addr): EthereumAccount => {
							const client = createWalletClient({
								account: addr as `0x${string}`,
								transport,
							});

							return {
								id: getWalletAccountId(wallet.id, addr),
								platform: "ethereum",
								walletName: wallet.name,
								walletId: wallet.id,
								address: addr as `0x${string}`,
								client,
								chainId,
							};
						});
					}),
				)
				.subscribe(subscriber);

			return () => {
				provider.off("chainChanged", handleChainChanged);
				provider.off("accountsChanged", handleAccountsChanged);
				provider.off("session_update", handleAccountsChanged);
				sub.unsubscribe();
			};
		}).pipe(shareReplay({ refCount: true, bufferSize: 1 })),
	);
};

export const getEthereumAccounts$ = (
	ethereumWallets: Observable<(EthereumWallet | WalletConnectWallet)[]>,
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
									.filter(isWalletConnectWallet)
									.map(getWalletConnectAccounts$),
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
