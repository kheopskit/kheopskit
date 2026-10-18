import { isEqual } from "lodash-es";
import { getInjectedExtensions } from "polkadot-api/pjs-signer";
import { distinctUntilChanged, map, type Observable } from "rxjs";
import { POLKADOT_EXTENSIONS } from "../../utils/polkadotExtensions";
import { createRegistryReads$ } from "../../utils/registryReads";
import {
	getWalletId,
	parseWalletId,
	type WalletId,
} from "../../utils/WalletId";
import { isRefusalMessage } from "../errors";
import { createInjectedWallets$ } from "../injectedWallets";
import type { KheopskitStore } from "../store";
import type { KheopskitConfig } from "../types";
import type {
	PolkadotInjected,
	PolkadotInjectedAccount,
	PolkadotInjectedWallet,
} from "./types";

type EnableResult = {
	accounts?: Partial<PolkadotInjected["accounts"]>;
	signer?: Partial<PolkadotInjected["signer"]>;
	metadata?: unknown;
	provider?: unknown;
};

type InjectedWeb3Window = {
	injectedWeb3?: Record<
		string,
		| { enable(appName: string): Promise<EnableResult | null | undefined> }
		| undefined
	>;
};

const isPolkadotInjected = (
	injected: EnableResult | null | undefined,
): injected is PolkadotInjected =>
	typeof injected?.accounts?.get === "function" &&
	typeof injected.accounts.subscribe === "function" &&
	typeof injected.signer?.signPayload === "function" &&
	typeof injected.signer.signRaw === "function";

/**
 * The list each extension last reported: read when its connect was granted,
 * so the emission that first shows the wallet connected already lists it, and
 * updated by every `subscribe` callback, so an accounts stream that restarts
 * resumes from the current list rather than the connect-time one.
 */
export const latestAccounts = new WeakMap<
	PolkadotInjected,
	PolkadotInjectedAccount[]
>();

type InjectedWeb3Entry = NonNullable<
	NonNullable<InjectedWeb3Window["injectedWeb3"]>[string]
>;

/**
 * The connect each extension is still answering. An extension keeps its
 * prompt open after kheopskit abandons the attempt, and a second `enable()`
 * meanwhile fails (polkadot-js: "Pending authorisation request already
 * exists") or resolves unauthorised (Talisman), so a new attempt joins this
 * one instead.
 */
const pendingConnects = new WeakMap<
	InjectedWeb3Entry,
	Promise<PolkadotInjected>
>();

const enableExtension = async (
	identifier: string,
	entry: InjectedWeb3Entry,
	appName: string,
) => {
	const injected = await entry.enable(appName);
	if (!isPolkadotInjected(injected))
		throw new Error(`Unsupported extension: "${identifier}"`);
	latestAccounts.set(injected, await injected.accounts.get());
	return injected;
};

const connectExtension = (
	identifier: string,
	appName: string,
): Promise<PolkadotInjected> => {
	const entry = (globalThis as InjectedWeb3Window).injectedWeb3?.[identifier];
	if (!entry)
		return Promise.reject(new Error(`Unavailable extension: "${identifier}"`));
	const pending = pendingConnects.get(entry);
	if (pending) return pending;
	const connecting = enableExtension(identifier, entry, appName);
	pendingConnects.set(entry, connecting);
	const settle = () => pendingConnects.delete(entry);
	connecting.then(settle, settle);
	return connecting;
};

const getInjectedWalletsIds = () =>
	typeof window === "undefined"
		? []
		: getInjectedExtensions().map((name) => getWalletId("polkadot", name));

// The shared WalletConnect connector is emitted once by core (see
// `getWallets$`), not per platform — so this returns only injected wallets.
export const getPolkadotWallets$ = (
	store: KheopskitStore,
	config: Pick<KheopskitConfig, "appName" | "walletConnect">,
	registryReads$: Observable<void> = createRegistryReads$(),
) =>
	createInjectedWallets$<WalletId, PolkadotInjectedWallet, PolkadotInjected>(
		store,
		{
			sources$: registryReads$.pipe(
				map(getInjectedWalletsIds),
				distinctUntilChanged<WalletId[]>(isEqual),
			),
			getWalletId: (walletId) => walletId,
			connect: (walletId) =>
				connectExtension(
					parseWalletId(walletId).identifier,
					config.appName ||
						config.walletConnect?.metadata.name ||
						window.location.hostname,
				),
			isUserRejection: isRefusalMessage,
			buildWallet: ({
				walletId,
				handle,
				status,
				error,
				isConnected,
				connect,
				disconnect,
			}) => {
				const { identifier } = parseWalletId(walletId);
				const extInfo = POLKADOT_EXTENSIONS[identifier];

				return {
					id: walletId,
					type: "injected",
					platform: "polkadot",
					name: extInfo?.name ?? identifier,
					icon: extInfo?.icon ?? "",
					sourceId: identifier,
					extension: handle,
					status,
					error,
					isConnected,
					connect,
					disconnect,
				};
			},
		},
	);
