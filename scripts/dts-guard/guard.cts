/**
 * Same checks as guard.mts, resolved through the `require` condition so they
 * land on the CJS declarations (`dist/index.d.ts`). Keep in sync with guard.mts.
 */

import type {
	createKheopskit as createCoreKheopskit,
	createKheopskitStore,
	KheopskitConfig,
	KheopskitPlatform,
	SyncableStorage,
	WalletConnectWallet,
	WalletId,
} from "@kheopskit/core";
import type {
	EthereumAccount,
	EthereumWallet,
	ethereum,
} from "@kheopskit/core/ethereum";
import type {
	serializeAccount,
	serializeWallet,
} from "@kheopskit/core/internal";
import type {
	PolkadotAccount,
	PolkadotInjectedWallet,
	PolkadotWallet,
	polkadot,
} from "@kheopskit/core/polkadot";
import type {
	SolanaAccount,
	SolanaSigner,
	SolanaWallet,
	solana,
} from "@kheopskit/core/solana";
import type {
	cachedAccountOf,
	cachedWalletOf,
	createFakePolkadotExtension,
	createMemoryStorage,
} from "@kheopskit/core/testing";
import type { walletConnect } from "@kheopskit/core/walletconnect";
import type {
	createKheopskit,
	useAccount,
	useAccounts,
	useConnect,
	useWallet,
	useWallets,
} from "@kheopskit/react";

type NotAny<T> = 0 extends 1 & T ? false : true;

type NoneAny<T extends readonly unknown[]> = T extends readonly [
	infer Head,
	...infer Rest,
]
	? NotAny<Head> extends true
		? NoneAny<Rest>
		: false
	: true;

type Expect<T extends true> = T;

type Equal<X, Y> =
	(<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
		? true
		: false;

type Bound = ReturnType<typeof createKheopskit<readonly [KheopskitPlatform]>>;

export type AccountsAreTyped = Expect<NotAny<ReturnType<typeof useAccounts>>>;
export type WalletsAreTyped = Expect<NotAny<ReturnType<typeof useWallets>>>;
export type BoundAccountsAreTyped = Expect<
	NotAny<ReturnType<Bound["useAccounts"]>>
>;
export type BoundWalletsAreTyped = Expect<
	NotAny<ReturnType<Bound["useWallets"]>>
>;

export type PolkadotIsTyped = Expect<
	NoneAny<[ReturnType<typeof polkadot>, PolkadotAccount, PolkadotWallet]>
>;
export type EthereumIsTyped = Expect<
	NoneAny<[ReturnType<typeof ethereum>, EthereumAccount, EthereumWallet]>
>;
export type SolanaIsTyped = Expect<
	NoneAny<
		[ReturnType<typeof solana>, SolanaAccount, SolanaWallet, SolanaSigner]
	>
>;
export type InternalIsTyped = Expect<
	NoneAny<
		[
			typeof serializeAccount,
			ReturnType<typeof serializeAccount>,
			typeof serializeWallet,
			ReturnType<typeof serializeWallet>,
		]
	>
>;

type Present<T> = Exclude<T, undefined>;

export type SigningSurfacesAreTyped = Expect<
	NoneAny<
		[
			Present<PolkadotAccount["txCreator"]>,
			Present<EthereumAccount["client"]>,
			Present<SolanaAccount["signer"]>,
			Present<EthereumWallet["provider"]>,
		]
	>
>;

export const polkadotTxCreator = (account: PolkadotAccount) => {
	// @ts-expect-error a placeholder has no txCreator
	const unnarrowed: Present<PolkadotAccount["txCreator"]> = account.txCreator;
	if (account.isPlaceholder) return unnarrowed;
	const narrowed: Present<PolkadotAccount["txCreator"]> = account.txCreator;
	return narrowed;
};

type PolkadotBound = ReturnType<
	typeof createKheopskit<readonly [ReturnType<typeof polkadot>]>
>;

export type SharedInstanceIsTyped = Expect<
	NoneAny<
		[
			PolkadotBound["kheopskit$"],
			PolkadotBound["store"],
			PolkadotBound["waitForAccount"],
			ReturnType<typeof useWallet>,
			ReturnType<typeof useAccount>,
			ReturnType<typeof useConnect>,
		]
	>
>;
export type RemovedGetKheopskit =
	// @ts-expect-error getKheopskit$ left the public API: use createKheopskit
	typeof import("@kheopskit/core").getKheopskit$;

type CorePolkadotKit = ReturnType<
	typeof createCoreKheopskit<readonly [ReturnType<typeof polkadot>]>
>;
type CoreState = Exclude<
	Awaited<ReturnType<CorePolkadotKit["kheopskit$"]["toPromise"]>>,
	undefined
>;
export type CoreWalletIsPlatformPrecise = Expect<
	Equal<CoreState["wallets"][number], PolkadotWallet | WalletConnectWallet>
>;
export type CoreAccountIsPlatformPrecise = Expect<
	Equal<CoreState["accounts"][number], PolkadotAccount>
>;

type WaitedEthereumAccount = Awaited<
	ReturnType<
		ReturnType<
			typeof createCoreKheopskit<readonly [ReturnType<typeof ethereum>]>
		>["waitForAccount"]
	>
>;
export type WaitedAccountIsLive = Expect<
	Equal<
		true extends WaitedEthereumAccount["isPlaceholder"] ? true : false,
		false
	>
>;
export type WaitedAccountIsEthereum = Expect<
	Equal<WaitedEthereumAccount["platform"], "ethereum">
>;

type ProviderProps<
	Kit extends { KheopskitProvider: (props: never) => unknown },
> = Parameters<Kit["KheopskitProvider"]>[0];
type SsrBound = ReturnType<
	typeof createKheopskit<readonly [ReturnType<typeof polkadot>], { ssr: true }>
>;
export const ssrProviderProps: ProviderProps<SsrBound> = { ssrCookies: "" };
export const plainProviderProps: ProviderProps<PolkadotBound> = {
	// @ts-expect-error ssrCookies needs an instance created with { ssr: true }
	ssrCookies: "",
};

export type BoundWalletIsPlatformPrecise = Expect<
	Equal<
		ReturnType<PolkadotBound["useWallet"]>,
		PolkadotWallet | WalletConnectWallet | undefined
	>
>;
export type BoundAccountIsPlatformPrecise = Expect<
	Equal<ReturnType<PolkadotBound["useAccount"]>, PolkadotAccount | undefined>
>;

declare const boundAccount: ReturnType<PolkadotBound["useAccount"]>;
export const boundAccountTxCreator = () => {
	if (!boundAccount) return;
	// @ts-expect-error a placeholder has no txCreator
	const unnarrowed: Present<PolkadotAccount["txCreator"]> =
		boundAccount.txCreator;
	if (boundAccount.isPlaceholder) return unnarrowed;
	const narrowed: Present<PolkadotAccount["txCreator"]> =
		boundAccount.txCreator;
	return narrowed;
};

export const polkadotSignRaw = (account: PolkadotAccount) => {
	// @ts-expect-error a placeholder has no signRaw
	const unnarrowed: Present<PolkadotAccount["signRaw"]> = account.signRaw;
	if (account.isPlaceholder) return unnarrowed;
	const narrowed: Present<PolkadotAccount["signRaw"]> = account.signRaw;
	return narrowed;
};

export const ethereumClient = (account: EthereumAccount) => {
	// @ts-expect-error a placeholder has no client
	const unnarrowed: Present<EthereumAccount["client"]> = account.client;
	if (account.isPlaceholder) return unnarrowed;
	const narrowed: Present<EthereumAccount["client"]> = account.client;
	return narrowed;
};

export const solanaSigner = (account: SolanaAccount) => {
	// @ts-expect-error a placeholder has no signer
	const unnarrowed: SolanaSigner = account.signer;
	if (account.isPlaceholder) return unnarrowed;
	const narrowed: SolanaSigner = account.signer;
	return narrowed;
};

export const walletConnectAppKit = (wallet: WalletConnectWallet) => {
	// @ts-expect-error a placeholder has no appKit
	wallet.appKit.getAccount("eip155");
	if (wallet.isPlaceholder) return;
	return wallet.appKit.getAccount("eip155");
};
export type PlaceholderAppKitIsAbsent = Expect<
	Equal<
		Extract<WalletConnectWallet, { isPlaceholder: true }>["appKit"],
		undefined
	>
>;

export const ethereumProvider = (wallet: EthereumWallet) => {
	// @ts-expect-error a placeholder has no provider
	const unnarrowed: Present<EthereumWallet["provider"]> = wallet.provider;
	if (wallet.isPlaceholder) return unnarrowed;
	const narrowed: Present<EthereumWallet["provider"]> = wallet.provider;
	return narrowed;
};

declare const polkadotWallet: PolkadotInjectedWallet;
export const rawSignature = polkadotWallet.extension?.signer.signRaw({
	address: "",
	data: "",
	type: "payload",
});
export type ReadonlyIsOptionalBoolean = Expect<
	Equal<PolkadotAccount["readonly"], boolean | undefined>
>;
export type SignRawReturnsHex = Expect<
	Equal<ReturnType<Present<PolkadotAccount["signRaw"]>>, Promise<`0x${string}`>>
>;
export type WalletConnectIsTyped = Expect<
	NoneAny<[typeof walletConnect, ReturnType<typeof walletConnect>]>
>;
export const rawWalletConnectOptions: KheopskitConfig["walletConnect"] = {
	// @ts-expect-error raw WalletConnect options are no longer a valid config value
	projectId: "x",
};

export type TestingIsTyped = Expect<
	NoneAny<
		[
			ReturnType<typeof createFakePolkadotExtension>,
			ReturnType<typeof createMemoryStorage>,
			ReturnType<typeof cachedWalletOf>,
			ReturnType<typeof cachedAccountOf>,
		]
	>
>;

declare const createStore: typeof createKheopskitStore;
declare const memoryStorage: typeof createMemoryStorage;
declare const fakeExtension: typeof createFakePolkadotExtension;
declare const walletOf: typeof cachedWalletOf;
declare const accountOf: typeof cachedAccountOf;
const storage: SyncableStorage = memoryStorage();
const seeded = createStore({ storage });
const fake = fakeExtension({ name: "talisman", enable: "hold" });
const fakeWalletId: WalletId = fake.walletId;
const talisman = walletOf(fake.walletId, "Talisman");
seeded.rememberWallet(fakeWalletId);
export const seededState = seeded.setCachedState(
	[talisman],
	[accountOf(talisman, "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY")],
);
