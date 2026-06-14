import type { KheopskitPlatform, KheopskitState } from "@kheopskit/core";
import { useContext } from "react";
import { KheopskitContext } from "./context";

/**
 * Returns the current kheopskit state (wallets, accounts, config, isHydrating).
 *
 * Pass the platform tuple as a type argument to recover SDK-precise account and
 * wallet types — `useWallets<typeof platforms>()`. React contexts can't be
 * generic, so without the argument the state is typed with the base
 * (SDK-free) wallet/account shapes.
 */
export const useWallets = <
	P extends readonly KheopskitPlatform[] = readonly KheopskitPlatform[],
>(): KheopskitState<P> => {
	const ctx = useContext(KheopskitContext);

	if (!ctx)
		throw new Error("useWallets can't be used without a KheopskitProvider");

	return ctx.state as unknown as KheopskitState<P>;
};
