import {
	KheopskitError,
	type WalletId,
	type WalletStatus,
} from "@kheopskit/core";
import { useEffect, useLayoutEffect, useMemo } from "react";
import {
	type KheopskitExternalStore,
	useKheopskitExternalStore,
} from "./context";
import { walletActions } from "./liveActions";
import { useWallet } from "./useWallet";

export type UseConnectResult = {
	/**
	 * Connects the wallet through the pipeline that runs when it is called, and
	 * waits for that pipeline's first emission when an `<Activity>` reveal has
	 * just restarted it. Resolves once the state shows the wallet connected.
	 * Unmounting the component or changing `walletId` aborts a pending connect,
	 * which then resolves without connecting. A connect that starts after
	 * unmount, or through a `connect` captured before `walletId` changed,
	 * rejects `ABORTED` without asking the wallet. Rejects with the wallet's
	 * `KheopskitError` otherwise, such as `USER_REJECTED`, and with an `Error`
	 * when the state lists no wallet with this id.
	 */
	connect: () => Promise<void>;
	/** Disconnects the wallet. Resolves once the state shows it disconnected. */
	disconnect: () => Promise<void>;
	/** `undefined` while the state lists no wallet with this id. */
	status: WalletStatus | undefined;
	/** The last connect the platform refused or failed. */
	error: KheopskitError | undefined;
};

const useIsomorphicLayoutEffect =
	typeof window === "undefined" ? useEffect : useLayoutEffect;

// React runs every layout setup of a commit synchronously, so once this
// microtask runs a mounted owner has renewed its scope.
const afterThisCommitsLayoutEffects = () => Promise.resolve();

const createWalletActions = (
	store: KheopskitExternalStore,
	walletId: WalletId,
) => {
	let scope = new AbortController();
	const wallet = walletActions(store, walletId);

	return {
		connect: async () => {
			if (scope.signal.aborted) await afterThisCommitsLayoutEffects();
			const { signal } = scope;
			if (signal.aborted)
				throw new KheopskitError(
					"ABORTED",
					`connect of wallet ${walletId} started after useConnect unmounted or switched wallet`,
					{ walletId },
				);
			try {
				await wallet.connect({ signal });
			} catch (error) {
				const abortedByCleanup =
					signal.aborted &&
					error instanceof KheopskitError &&
					error.code === "ABORTED";
				if (!abortedByCleanup) throw error;
			}
		},
		disconnect: wallet.disconnect,
		renew: () => {
			if (scope.signal.aborted) scope = new AbortController();
		},
		abort: () => scope.abort(),
	};
};

/**
 * Connect and disconnect actions for one wallet, with its status and error.
 * `connect` and `disconnect` keep their identity while `walletId` is the same,
 * so `useEffect(() => { connect() }, [connect])` connects on mount and after
 * every `<Activity>` reveal.
 *
 * @example
 * ```tsx
 * const ConnectButton = ({ walletId }: { walletId: WalletId }) => {
 *   const { connect, disconnect, status } = useConnect(walletId);
 *   if (status === "connected") return <button onClick={disconnect}>Disconnect</button>;
 *   return <button disabled={status === "connecting"} onClick={connect}>Connect</button>;
 * };
 * ```
 */
export const useConnect = (walletId: WalletId): UseConnectResult => {
	const store = useKheopskitExternalStore("useConnect");
	const wallet = useWallet(walletId);
	const actions = useMemo(
		() => createWalletActions(store, walletId),
		[store, walletId],
	);

	useIsomorphicLayoutEffect(() => actions.renew(), [actions]);
	useEffect(() => () => actions.abort(), [actions]);

	return {
		connect: actions.connect,
		disconnect: actions.disconnect,
		status: wallet?.status,
		error: wallet?.error,
	};
};
