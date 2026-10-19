import type { WalletId } from "../utils/WalletId";
import { KheopskitError } from "./errors";
import type { Liveness, LivePipeline, PipelineEnd } from "./livePipeline";
import type { ConnectOptions, KheopskitState } from "./types";

export type WalletActions = {
	connect: (options?: ConnectOptions) => Promise<void>;
	disconnect: () => Promise<void>;
};

const didNotRun: Record<PipelineEnd, string> = {
	aborted: "was aborted",
	unheld:
		"was called while nothing subscribes this kheopskit instance's kheopskit$ (a mounted, visible KheopskitProvider subscribes it)",
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

// Holds taken and releases queued in the caller's task (a React commit's
// layout effects, an rxjs `take(1)` unsubscribing) land before this microtask.
const whenLiveAfterTheCallersTask = async (
	pipeline: LivePipeline<KheopskitState>,
	signal: AbortSignal | undefined,
): Promise<Liveness<KheopskitState>> => {
	await Promise.resolve();
	return pipeline.whenLive(signal);
};

/**
 * `connect` and `disconnect` for one wallet id that act on the pipeline's run
 * at call time: they wait for a restarted run's first emission and reject
 * `ABORTED` while nothing holds the pipeline, without starting it.
 */
export const walletActions = (
	pipeline: LivePipeline<KheopskitState>,
	walletId: WalletId,
): WalletActions => {
	const liveWallet = async (
		operation: "connect" | "disconnect",
		signal?: AbortSignal,
	) => {
		const liveness = await whenLiveAfterTheCallersTask(pipeline, signal);
		if (liveness.end) throw abortedError(walletId, operation, liveness.end);
		const wallet = liveness.state.wallets.find(
			(candidate) => candidate.id === walletId,
		);
		if (!wallet) throw new Error(`[kheopskit] no wallet ${walletId}`);
		return wallet;
	};
	return {
		connect: async (options) =>
			(await liveWallet("connect", options?.signal)).connect(options),
		disconnect: async () => (await liveWallet("disconnect")).disconnect(),
	};
};

/**
 * Gives every wallet of a state the pipeline's call-time actions, memoised per
 * state so a state presented twice is the same object.
 */
export const createPresenter = (pipeline: LivePipeline<KheopskitState>) => {
	const presented = new WeakMap<KheopskitState, KheopskitState>();
	return (state: KheopskitState): KheopskitState => {
		let live = presented.get(state);
		if (!live) {
			live = {
				...state,
				wallets: state.wallets.map((wallet) => ({
					...wallet,
					...walletActions(pipeline, wallet.id),
				})),
			};
			presented.set(state, live);
		}
		return live;
	};
};
