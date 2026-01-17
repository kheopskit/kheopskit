import { isEqual } from "lodash";
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
	mergeMap,
	Observable,
	of,
	shareReplay,
	timer,
} from "rxjs";
import { store } from "@/api/store";
import type {
	KheopskitConfig,
	PolkadotInjectedWallet,
	PolkadotWallet,
} from "@/api/types";
import { POLKADOT_EXTENSIONS } from "@/utils/polkadotExtensions";
import { getWalletId, parseWalletId, type WalletId } from "@/utils/WalletId";
import { getAppKitWallets$ } from "../appKit";

const getInjectedWalletsIds = () =>
	getInjectedExtensions().map((name) => getWalletId("polkadot", name));

export const polkadotInjectedWallets$ = new Observable<
	PolkadotInjectedWallet[]
>((subscriber) => {
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

	const walletIds$ = of(0, 200, 500, 1000) // poll for wallets that inject after page load
		.pipe(
			mergeMap((time) => timer(time)),
			map(() => getInjectedWalletsIds()),
			distinctUntilChanged<WalletId[]>(isEqual),
		);

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
		// console.log("Unsubscribing from polkadotInjectedWallets$");
		subscription.unsubscribe();
	};
}).pipe(
	// logObservable("polkadotInjectedWallets$"),
	shareReplay({ refCount: true, bufferSize: 1 }),
);

export const getPolkadotWallets$ = (config: KheopskitConfig) => {
	return new Observable<PolkadotWallet[]>((subscriber) => {
		const subscription = combineLatest([
			polkadotInjectedWallets$,
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
	}).pipe(
		// logObservable("getPolkadotWallets$"),
		shareReplay({ refCount: true, bufferSize: 1 }),
	);
};
