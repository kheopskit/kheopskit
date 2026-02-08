import { isEqual } from "lodash-es";
import {
	connectInjectedExtension,
	getInjectedExtensions,
	type InjectedExtension,
} from "polkadot-api/pjs-signer";
import {
	BehaviorSubject,
	combineLatest,
	distinctUntilChanged,
	map,
	Observable,
	shareReplay,
} from "rxjs";
import { POLKADOT_EXTENSIONS } from "../../utils/polkadotExtensions";
import {
	getWalletId,
	parseWalletId,
	type WalletId,
} from "../../utils/WalletId";
import { getAppKitWallets$ } from "../appKit";
import { store as defaultStore, type KheopskitStore } from "../store";
import type {
	KheopskitConfig,
	PolkadotInjectedWallet,
	PolkadotWallet,
} from "../types";

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

		const poll = () => {
			subscriber.next(getInjectedWalletsIds());
			if (index < intervals.length) {
				const delay = intervals[index++];
				setTimeout(poll, delay);
			}
		};

		// Start polling after first immediate emission
		if (intervals.length > 0) {
			setTimeout(poll, intervals[index++] ?? 100);
		}

		return () => {
			// Cleanup handled by setTimeout naturally expiring
		};
	}).pipe(
		distinctUntilChanged<WalletId[]>(isEqual),
		shareReplay({ refCount: true, bufferSize: 1 }),
	);
};

const createPolkadotInjectedWallets$ = (store: KheopskitStore) =>
	new Observable<PolkadotInjectedWallet[]>((subscriber) => {
		const enabledExtensions$ = new BehaviorSubject<
			Map<WalletId, InjectedExtension>
		>(new Map());

		const connect = async (walletId: WalletId) => {
			if (enabledExtensions$.value.has(walletId))
				throw new Error(`Extension ${walletId} already connected`);
			const { identifier } = parseWalletId(walletId);
			const extension = await connectInjectedExtension(identifier);

			const newMap = new Map(enabledExtensions$.value);
			newMap.set(walletId, extension);
			enabledExtensions$.next(newMap);

			store.addEnabledWalletId(walletId);
		};

		const disconnect = (walletId: WalletId) => {
			if (!enabledExtensions$.value.has(walletId))
				throw new Error(`Extension ${walletId} is not connected`);

			const newMap = new Map(enabledExtensions$.value);
			newMap.delete(walletId);
			enabledExtensions$.next(newMap);

			store.removeEnabledWalletId(walletId);
		};

		const walletIds$ = createWalletIdsPoller$();

		const subscription = combineLatest([walletIds$, enabledExtensions$])
			.pipe(
				map(([walletIds, enabledExtensions]) => {
					return walletIds.map((id): PolkadotInjectedWallet => {
						const { identifier } = parseWalletId(id);
						const extension = enabledExtensions.get(id);
						const extInfo = POLKADOT_EXTENSIONS[identifier];

						return {
							id,
							type: "injected",
							platform: "polkadot",
							name: extInfo?.name ?? identifier,
							icon: extInfo?.icon ?? "",
							extensionId: identifier,
							extension,
							isConnected: !!extension,
							connect: () => connect(id),
							disconnect: () => disconnect(id),
						};
					});
				}),
			)
			.subscribe(subscriber);

		return () => {
			subscription.unsubscribe();
		};
	}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));

export const getPolkadotWallets$ = (
	config: KheopskitConfig,
	store: KheopskitStore = defaultStore,
) => {
	return new Observable<PolkadotWallet[]>((subscriber) => {
		const subscription = combineLatest([
			createPolkadotInjectedWallets$(store),
			getAppKitWallets$(config)?.pipe(map((w) => w.polkadot)),
		])
			.pipe(
				map(([injectedWallets, appKitWallet]) =>
					appKitWallet ? [...injectedWallets, appKitWallet] : injectedWallets,
				),
			)
			.subscribe(subscriber);

		return () => {
			subscription.unsubscribe();
		};
	}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));
};
