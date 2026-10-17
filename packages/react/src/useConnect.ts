import {
	KheopskitError,
	type WalletId,
	type WalletStatus,
} from "@kheopskit/core";
import { useEffect, useMemo } from "react";
import {
	type KheopskitExternalStore,
	useKheopskitExternalStore,
} from "./context";
import { useWallet } from "./useWallet";

export type UseConnectResult = {
	/**
	 * Connects the wallet. Resolves once the state shows it connected. Unmounting
	 * the component or changing `walletId` aborts a pending connect, which then
	 * resolves without connecting. Rejects with the wallet's `KheopskitError`
	 * otherwise, such as `USER_REJECTED`, and with an `Error` when the state
	 * lists no wallet with this id.
	 */
	connect: () => Promise<void>;
	/** Disconnects the wallet. Resolves once the state shows it disconnected. */
	disconnect: () => Promise<void>;
	/** `undefined` while the state lists no wallet with this id. */
	status: WalletStatus | undefined;
	/** The last connect the platform refused or failed. */
	error: KheopskitError | undefined;
};

const createWalletActions = (
	store: KheopskitExternalStore,
	walletId: WalletId,
) => {
	let signal: AbortSignal | undefined;

	const currentWallet = () => {
		const wallet = store
			.getSnapshot()
			.wallets.find((candidate) => candidate.id === walletId);
		if (!wallet) throw new Error(`[kheopskit] no wallet ${walletId}`);
		return wallet;
	};

	return {
		connect: async () => {
			const callSignal = signal;
			try {
				await currentWallet().connect({ signal: callSignal });
			} catch (error) {
				const abortedByCleanup =
					callSignal?.aborted &&
					error instanceof KheopskitError &&
					error.code === "ABORTED";
				if (!abortedByCleanup) throw error;
			}
		},
		disconnect: async () => currentWallet().disconnect(),
		startAbortScope: () => {
			const controller = new AbortController();
			signal = controller.signal;
			return () => controller.abort();
		},
	};
};

/**
 * Connect and disconnect actions for one wallet, with its status and error.
 * `connect` and `disconnect` keep their identity while `walletId` is the same.
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

	useEffect(() => actions.startAbortScope(), [actions]);

	return {
		connect: actions.connect,
		disconnect: actions.disconnect,
		status: wallet?.status,
		error: wallet?.error,
	};
};
