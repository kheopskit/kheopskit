import {
	type ConnectOptions,
	KheopskitError,
	type KheopskitState,
	type WalletId,
} from "@kheopskit/core";
import type { KheopskitExternalStore } from "./context";

type Wallet = KheopskitState["wallets"][number];

const abortedError = (
	walletId: WalletId,
	operation: "connect" | "disconnect",
	signal: AbortSignal | undefined,
) =>
	new KheopskitError(
		"ABORTED",
		signal?.aborted
			? `${operation} of wallet ${walletId} was aborted`
			: `${operation} of wallet ${walletId} was called while no KheopskitProvider holds the pipeline (unmounted or hidden)`,
		{ walletId },
	);

/**
 * `connect` and `disconnect` for one wallet id that act on the running
 * pipeline at call time: they wait for the restarted pipeline's first emission
 * after an `<Activity>` reveal and reject `ABORTED` while no provider holds it.
 */
export const walletActions = (
	store: Pick<KheopskitExternalStore, "whenLive">,
	walletId: WalletId,
) => {
	const liveWallet = async (
		operation: "connect" | "disconnect",
		signal?: AbortSignal,
	) => {
		const state = await store.whenLive(signal);
		if (!state) throw abortedError(walletId, operation, signal);
		const wallet = state.wallets.find((candidate) => candidate.id === walletId);
		if (!wallet) throw new Error(`[kheopskit] no wallet ${walletId}`);
		return wallet;
	};
	return {
		connect: async (options?: ConnectOptions) =>
			(await liveWallet("connect", options?.signal)).connect(options),
		disconnect: async () => (await liveWallet("disconnect")).disconnect(),
	};
};

export const withLiveActions = (
	store: KheopskitExternalStore,
): KheopskitExternalStore => {
	const presented = new WeakMap<KheopskitState, KheopskitState>();
	const present = (state: KheopskitState) => {
		let live = presented.get(state);
		if (!live) {
			live = {
				...state,
				wallets: state.wallets.map(
					(wallet): Wallet => ({
						...wallet,
						...walletActions(store, wallet.id),
					}),
				),
			};
			presented.set(state, live);
		}
		return live;
	};
	return {
		...store,
		getSnapshot: () => present(store.getSnapshot()),
		getServerSnapshot: () => present(store.getServerSnapshot()),
	};
};
