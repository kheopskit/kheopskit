import { isEqual } from "lodash-es";
import {
	connectInjectedExtension,
	getInjectedExtensions,
	type InjectedExtension,
} from "polkadot-api/pjs-signer";
import { distinctUntilChanged, Observable, shareReplay } from "rxjs";
import { POLKADOT_EXTENSIONS } from "../../utils/polkadotExtensions";
import {
	getWalletId,
	parseWalletId,
	type WalletId,
} from "../../utils/WalletId";
import { createInjectedWallets$ } from "../injectedWallets";
import type { KheopskitStore } from "../store";
import type { PolkadotInjectedWallet } from "./types";

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

		return () => {
			// Cancel any pending poll so it can't fire after unsubscribe.
			if (timer !== undefined) clearTimeout(timer);
		};
	}).pipe(
		distinctUntilChanged<WalletId[]>(isEqual),
		shareReplay({ refCount: true, bufferSize: 1 }),
	);
};

// The shared WalletConnect connector is emitted once by core (see
// `getWallets$`), not per platform — so this returns only injected wallets.
export const getPolkadotWallets$ = (store: KheopskitStore) =>
	createInjectedWallets$<WalletId, PolkadotInjectedWallet, InjectedExtension>(
		store,
		{
			sources$: createWalletIdsPoller$(),
			getWalletId: (walletId) => walletId,
			connect: (walletId) => {
				const { identifier } = parseWalletId(walletId);
				return connectInjectedExtension(identifier);
			},
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
