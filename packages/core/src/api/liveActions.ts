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

const whenLiveAfterTheCallersTask = async (
	pipeline: LivePipeline<KheopskitState>,
	signal: AbortSignal | undefined,
): Promise<Liveness<KheopskitState>> => {
	await Promise.resolve();
	return pipeline.whenLive(signal);
};

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

type Wallet = KheopskitState["wallets"][number];

export const createPresenter = (pipeline: LivePipeline<KheopskitState>) => {
	const presentedStates = new WeakMap<KheopskitState, KheopskitState>();
	const presentedWallets = new WeakMap<Wallet, Wallet>();
	const presentWallet = (wallet: Wallet): Wallet => {
		let live = presentedWallets.get(wallet);
		if (!live) {
			live = { ...wallet, ...walletActions(pipeline, wallet.id) };
			presentedWallets.set(wallet, live);
		}
		return live;
	};
	return (state: KheopskitState): KheopskitState => {
		let live = presentedStates.get(state);
		if (!live) {
			live = { ...state, wallets: state.wallets.map(presentWallet) };
			presentedStates.set(state, live);
		}
		return live;
	};
};
