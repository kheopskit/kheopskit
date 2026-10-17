import type { KheopskitPlatform, KheopskitState } from "@kheopskit/core";
import { useSyncExternalStore } from "react";
import { useKheopskitExternalStore } from "./context";

/**
 * Returns the current kheopskit state (wallets, accounts, config, isHydrating)
 * and re-renders on every change. To follow one wallet or account, prefer
 * {@link useWallet} or {@link useAccount}. Each wallet's `connect` and
 * `disconnect` act on the instance's pipeline when they are called, while
 * anything holds it.
 *
 * Pass the platform tuple as a type argument to recover SDK-precise account and
 * wallet types — `useWallets<typeof platforms>()`. React contexts can't be
 * generic, so without the argument the state is typed with the base
 * (SDK-free) wallet/account shapes.
 */
export const useWallets = <
	P extends readonly KheopskitPlatform[] = readonly KheopskitPlatform[],
>(): KheopskitState<P> => {
	const store = useKheopskitExternalStore("useWallets");
	return useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getServerSnapshot,
	) as unknown as KheopskitState<P>;
};
