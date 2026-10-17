import {
	type ConnectOptions,
	KheopskitError,
	type KheopskitState,
	type WalletId,
} from "@kheopskit/core";
import type { KheopskitExternalStore } from "./context";
import type { PipelineEnd } from "./livePipeline";

type Wallet = KheopskitState["wallets"][number];

const didNotRun: Record<PipelineEnd, string> = {
	aborted: "was aborted",
	unheld:
		"was called while nothing holds the pipeline (no KheopskitProvider of this instance is mounted and visible, and nothing subscribes its kheopskit$)",
	errored: "did not run because the pipeline stopped with an error",
	completed: "did not run because the pipeline completed",
};

const abortedError = (
	walletId: WalletId,
	operation: "connect" | "disconnect",
	end: PipelineEnd,
) =>
	new KheopskitError(
		"ABORTED",
		`${operation} of wallet ${walletId} ${didNotRun[end]}`,
		{ walletId },
	);

/**
 * `connect` and `disconnect` for one wallet id that act on the instance's
 * pipeline at call time: they wait for the restarted pipeline's first emission
 * after an `<Activity>` reveal and reject `ABORTED` while nothing holds it.
 */
export const walletActions = (
	store: Pick<KheopskitExternalStore, "whenLive">,
	walletId: WalletId,
) => {
	const liveWallet = async (
		operation: "connect" | "disconnect",
		signal?: AbortSignal,
	) => {
		const liveness = await store.whenLive(signal);
		if (liveness.end) throw abortedError(walletId, operation, liveness.end);
		const wallet = liveness.state.wallets.find(
			(candidate) => candidate.id === walletId,
		);
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
