import { hex } from "@scure/base";
import type {
	KeypairType,
	SignPayload,
	SignRaw,
} from "polkadot-api/pjs-signer";
import * as pjs from "polkadot-api/pjs-signer";
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
	WalletConnectProvider,
	WalletConnectWallet,
} from "../types";
import type {
	PolkadotAccount,
	PolkadotInjectedAccount,
	PolkadotInjectedWallet,
	PolkadotSignRawType,
	PolkadotWallet,
} from "./types";
import { latestAccounts } from "./wallets";

type RawSignature = `0x${string}`;

const encodeRawData = (
	data: string | Uint8Array,
	type?: PolkadotSignRawType,
): { data: string; type: PolkadotSignRawType } =>
	typeof data === "string"
		? { data, type: type ?? "payload" }
		: { data: `0x${hex.encode(data)}`, type: type ?? "bytes" };

/**
 * pjs-signer's signature-type map knows ed25519, sr25519 and ecdsa only, so an
 * `ethereum` type would get a 64-byte mock signature where ecdsa needs 65.
 */
const toSignerType = (type: PolkadotAccountType): KeypairType =>
	type === "ethereum" ? "ecdsa" : type;

const getInjectedWalletAccounts$ = (
	wallet: PolkadotInjectedWallet,
): Observable<PolkadotAccount[]> => {
	const injected = wallet.extension;
	if (!wallet.isConnected || !injected) return of([]);

	return new Observable<PolkadotAccount[]>((subscriber) => {
		const signPayload = injected.signer.signPayload.bind(injected.signer);
		const signRaw = injected.signer.signRaw.bind(injected.signer);
		const { field, factory } = getPjsSignerField();

		const toAccount = (account: PolkadotInjectedAccount): PolkadotAccount => {
			const { address } = account;
			const type = account.type ?? "sr25519";
			return {
				...account,
				id: getWalletAccountId(wallet.id, address),
				type,
				platform: "polkadot",
				walletName: wallet.name,
				walletId: wallet.id,
				[field]: factory(address, signPayload, signRaw, toSignerType(type)),
				signRaw: async (data, options) =>
					(await signRaw({ address, ...encodeRawData(data, options?.type) }))
						.signature,
			} as Exclude<PolkadotAccount, { isPlaceholder: true }>;
		};

		const toAccounts = (accounts: PolkadotInjectedAccount[]) =>
			accounts.flatMap((account) => {
				try {
					return [toAccount(account)];
				} catch {
					return [];
				}
			});

		const emit = (accounts: PolkadotInjectedAccount[]) => {
			latestAccounts.set(injected, accounts);
			subscriber.next(toAccounts(accounts));
		};

		emit(latestAccounts.get(injected) ?? []);
		return injected.accounts.subscribe(emit);
	});
};

/**
 * polkadot-api v2's `getPolkadotSignerFromPjs` takes three parameters and
 * ignores the fourth at runtime.
 */
type PjsSignerFactory = (
	address: string,
	signPayload: SignPayload,
	signRaw: SignRaw,
	type?: KeypairType,
) => unknown;

type PjsSignerModule = {
	getTxCreatorFromPjs?: PjsSignerFactory;
	getPolkadotSignerFromPjs?: PjsSignerFactory;
};

/**
 * polkadot-api v3 replaced `polkadotSigner` (PolkadotSigner) with `txCreator`
 * (TxCreator). Which one the app's installed version provides is detected at
 * runtime so a single @kheopskit/core release supports both.
 */
const getPjsSignerField = (): {
	field: "txCreator" | "polkadotSigner";
	factory: PjsSignerFactory;
} => {
	const module = pjs as PjsSignerModule;
	if (module.getTxCreatorFromPjs)
		return { field: "txCreator", factory: module.getTxCreatorFromPjs };
	if (module.getPolkadotSignerFromPjs)
		return {
			field: "polkadotSigner",
			factory: module.getPolkadotSignerFromPjs,
		};
	throw new KheopskitError(
		"UNSUPPORTED_VERSION",
		"Unsupported polkadot-api/pjs-signer version",
	);
};

const requestSignMessage = (
	appKit: AppKitInstance,
	provider: WalletConnectProvider,
	address: string,
	message: string,
) => {
	if (!provider.session)
		throw new KheopskitError("NO_SESSION", "No session found");
	const chainId = appKit.getCaipNetworks("polkadot")[0]?.caipNetworkId;
	if (!chainId)
		throw new KheopskitError(
			"NO_SESSION",
			"No CAIP network available for polkadot",
		);

	return provider.client.request<{ signature: RawSignature }>({
		topic: provider.session.topic,
		chainId,
		request: {
			method: "polkadot_signMessage",
			params: { address, message },
		},
	});
};

const getAppKitPolkadotSigning = (appKit: AppKitInstance, address: string) => {
	const provider = appKit.getProvider("polkadot");
	if (!provider) throw new KheopskitError("NO_PROVIDER", "No provider found");
	if (!provider.session)
		throw new KheopskitError("NO_SESSION", "No session found");

	const signMessage = (message: string) =>
		requestSignMessage(appKit, provider, address, message);

	const { field, factory } = getPjsSignerField();

	const signer = factory(
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
		async ({ data }) => ({
			id: 0,
			signature: (await signMessage(data)).signature,
		}),
		"sr25519",
	);

	const signRaw: PolkadotAccount["signRaw"] = async (data) =>
		(await signMessage(encodeRawData(data).data)).signature;

	return { [field]: signer, signRaw };
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
				(address) =>
					({
						id: getWalletAccountId(wallet.id, address),
						platform: "polkadot",
						walletName: wallet.name,
						walletId: wallet.id,
						address,
						...getAppKitPolkadotSigning(wallet.appKit, address),
						genesisHash: null,
						name: `${wallet.name} Polkadot`,
						// WalletConnect (Reown AppKit) doesn't expose account key type;
						// default to sr25519, which is the most common Polkadot key type.
						type: "sr25519",
					}) as PolkadotAccount,
			);
		},
	});

export const getPolkadotAccounts$ = (
	polkadotWallets$: Observable<(PolkadotWallet | WalletConnectWallet)[]>,
	polkadotAccountTypes: PolkadotAccountType[],
) => {
	if (polkadotAccountTypes.length === 0) {
		console.warn(
			"[kheopskit] polkadot({ accountTypes }) is empty; all Polkadot accounts will be filtered out.",
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
