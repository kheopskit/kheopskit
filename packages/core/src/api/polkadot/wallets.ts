import { isEqual } from "lodash-es";
import { getInjectedExtensions } from "polkadot-api/pjs-signer";
import { distinctUntilChanged, Observable, shareReplay, skip } from "rxjs";
import { pageLoaded$ } from "../../utils/pageLoad";
import { POLKADOT_EXTENSIONS } from "../../utils/polkadotExtensions";
import {
	getWalletId,
	parseWalletId,
	type WalletId,
} from "../../utils/WalletId";
import { createInjectedWallets$ } from "../injectedWallets";
import type { KheopskitStore } from "../store";
import type { KheopskitConfig } from "../types";
import type { PolkadotInjected, PolkadotInjectedWallet } from "./types";

type InjectedWeb3Window = {
	injectedWeb3?: Record<
		string,
		{ enable(appName: string): Promise<PolkadotInjected> } | undefined
	>;
};

const enableExtension = async (identifier: string, appName: string) => {
	const entry = (globalThis as InjectedWeb3Window).injectedWeb3?.[identifier];
	if (!entry) throw new Error(`Unavailable extension: "${identifier}"`);
	return entry.enable(appName);
};

const getInjectedWalletsIds = () =>
	typeof window === "undefined"
		? []
		: getInjectedExtensions().map((name) => getWalletId("polkadot", name));

// Create a polling observable that starts immediately and polls at intervals
const createWalletIdsPoller$ = () => {
	return new Observable<WalletId[]>((subscriber) => {
		// Emit immediately on subscribe
		subscriber.next(getInjectedWalletsIds());

		// Poll at shorter intervals initially, then slow down
		const intervals = [100, 200, 300, 500];
		let index = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const poll = () => {
			subscriber.next(getInjectedWalletsIds());
			if (index < intervals.length) {
				const delay = intervals[index++];
				timer = setTimeout(poll, delay);
			}
		};

		// Start polling after first immediate emission
		if (intervals.length > 0) {
			timer = setTimeout(poll, intervals[index++] ?? 100);
		}

		let loadTimer: ReturnType<typeof setTimeout> | undefined;
		const loadSub = pageLoaded$.pipe(skip(1)).subscribe(() => {
			loadTimer = setTimeout(
				() => subscriber.next(getInjectedWalletsIds()),
				100,
			);
			subscriber.next(getInjectedWalletsIds());
		});

		return () => {
			// Cancel any pending poll so it can't fire after unsubscribe.
			if (timer !== undefined) clearTimeout(timer);
			clearTimeout(loadTimer);
			loadSub.unsubscribe();
		};
	}).pipe(
		distinctUntilChanged<WalletId[]>(isEqual),
		shareReplay({ refCount: true, bufferSize: 1 }),
	);
};

// The shared WalletConnect connector is emitted once by core (see
// `getWallets$`), not per platform — so this returns only injected wallets.
export const getPolkadotWallets$ = (
	store: KheopskitStore,
	config: Pick<KheopskitConfig, "appName" | "walletConnect">,
) =>
	createInjectedWallets$<WalletId, PolkadotInjectedWallet, PolkadotInjected>(
		store,
		{
			sources$: createWalletIdsPoller$(),
			getWalletId: (walletId) => walletId,
			connect: (walletId) =>
				enableExtension(
					parseWalletId(walletId).identifier,
					config.appName ||
						config.walletConnect?.metadata.name ||
						window.location.hostname,
				),
			buildWallet: ({ walletId, handle, isConnected, connect, disconnect }) => {
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
					isConnected,
					connect,
					disconnect,
				};
			},
		},
	);
