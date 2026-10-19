import { defer, map, type Observable, ReplaySubject, share } from "rxjs";
import {
	parseWalletAccountId,
	type WalletAccountId,
} from "../utils/WalletAccountId";
import type { WalletId } from "../utils/WalletId";
import { resolveConfig } from "./config";
import { accountUnavailableError, KheopskitError } from "./errors";
import { kheopskitRun$ } from "./kheopskit";
import {
	createPresenter,
	type WalletActions,
	walletActions,
} from "./liveActions";
import { createLivePipeline, type PipelineEnd } from "./livePipeline";
import { createKheopskitStore } from "./store";
import type {
	AccountOf,
	KheopskitConfig,
	KheopskitPlatform,
	KheopskitState,
	KheopskitStore,
} from "./types";

export type CreateKheopskitConfig<P extends readonly KheopskitPlatform[]> =
	Omit<Partial<KheopskitConfig<P>>, "platforms"> & {
		/** Platform plugins, e.g. `[polkadot(), solana()]`. Required. */
		platforms: P;
	};

/** Where the instance persists. Exactly one source; both cannot compile. */
export type CreateKheopskitOptions =
	| {
			/** Store the instance reads the cache from and persists into. */
			store: KheopskitStore;
			ssr?: never;
	  }
	| {
			store?: never;
			/**
			 * Persist in cookies, so a server render can read them through
			 * `ssrCookies`. Default: localStorage.
			 */
			ssr?: boolean;
	  };

type WaitForAccount<A> = (
	accountId: WalletAccountId,
	options?: { signal?: AbortSignal },
) => Promise<A>;

/**
 * One kheopskit instance. Subscribing `kheopskit$` holds its pipeline: it
 * runs while at least one subscriber stays, and every subscriber shares that
 * one run. When the last subscriber leaves, it stops. The next subscriber
 * starts a new run, which re-reads the cache.
 *
 * A wallet's `connect` and `disconnect`, read from any emission, act on the
 * run that is live when they are called. They wait for a restarted run's
 * first emission, reject `ABORTED` while nothing subscribes, and never start
 * the pipeline themselves.
 */
export type Kheopskit<P extends readonly KheopskitPlatform[]> = {
	readonly kheopskit$: Observable<KheopskitState<P>>;
	/** Created on first use. Destructuring it creates nothing. */
	readonly store: KheopskitStore;
	/**
	 * Resolves with the account once the live run lists it as a live account,
	 * at once when it already does. Waits while the run hydrates or the
	 * account's wallet is `connecting`. Rejects `ACCOUNT_UNAVAILABLE` once
	 * neither holds and the account is still not live. Rejects `ABORTED` when
	 * nothing subscribes `kheopskit$` by the end of the calling task, when the
	 * last subscriber leaves, or when `signal` fires. It never starts or holds
	 * the pipeline.
	 */
	readonly waitForAccount: WaitForAccount<
		Exclude<AccountOf<P[number]>, { isPlaceholder: true }>
	>;
};

type LiveAccountOf<S extends KheopskitState> = Exclude<
	S["accounts"][number],
	{ isPlaceholder: true }
>;

type AccountLookup<A> =
	| { status: "live"; account: A }
	| { status: "unavailable" };

const lookUpAccount = <S extends KheopskitState>(
	state: S,
	accountId: WalletAccountId,
	walletId: WalletId,
): AccountLookup<LiveAccountOf<S>> | undefined => {
	const account = state.accounts.find(
		(candidate): candidate is LiveAccountOf<S> =>
			candidate.id === accountId && !candidate.isPlaceholder,
	);
	if (account) return { status: "live", account };
	const wallet = state.wallets.find((candidate) => candidate.id === walletId);
	if (state.isHydrating || wallet?.status === "connecting") return undefined;
	return { status: "unavailable" };
};

const didNotWait: Record<PipelineEnd, string> = {
	aborted: "was aborted",
	unheld:
		"was called while nothing subscribes this kheopskit instance's kheopskit$ (a mounted, visible KheopskitProvider subscribes it)",
	errored: "did not run because the pipeline stopped with an error",
	completed: "did not run because the pipeline completed",
};

type KheopskitInternals = {
	present: (state: KheopskitState) => KheopskitState;
	walletActions: (walletId: WalletId) => WalletActions;
};

const internals = new WeakMap<object, KheopskitInternals>();

export const createInstance = <T extends KheopskitState>(
	run$: () => Observable<T>,
	store: KheopskitStore,
): {
	readonly kheopskit$: Observable<T>;
	readonly store: KheopskitStore;
	readonly waitForAccount: WaitForAccount<LiveAccountOf<T>>;
} => {
	const pipeline = createLivePipeline(
		defer(run$).pipe(
			share({
				connector: () => new ReplaySubject(1),
				resetOnError: true,
				resetOnComplete: true,
				resetOnRefCountZero: true,
			}),
		),
	);
	const present = createPresenter(pipeline);
	const waitForAccount: WaitForAccount<LiveAccountOf<T>> = async (
		accountId,
		{ signal } = {},
	) => {
		const { walletId } = parseWalletAccountId(accountId);
		await Promise.resolve();
		const found = await pipeline.whenLivePicks(
			(state) => lookUpAccount(state, accountId, walletId),
			signal,
		);
		if (found.end)
			throw new KheopskitError(
				"ABORTED",
				`waitForAccount of account ${accountId} ${didNotWait[found.end]}`,
				{ walletId },
			);
		if (found.state.status === "unavailable")
			throw accountUnavailableError(accountId, walletId);
		return found.state.account;
	};
	const kit = {
		kheopskit$: pipeline.observable$.pipe(map(present)) as Observable<T>,
		store,
		waitForAccount,
	};
	internals.set(kit, {
		present,
		walletActions: (walletId) => walletActions(pipeline, walletId),
	});
	return kit;
};

export const kheopskitInternals = (
	kit: Kheopskit<readonly KheopskitPlatform[]>,
): KheopskitInternals => {
	const found = internals.get(kit);
	if (!found) throw new Error("[kheopskit] not a kheopskit instance");
	return found;
};

const lazyStore = (create: () => KheopskitStore): KheopskitStore => ({
	observable: defer(() => create().observable),
	rememberWallet: (walletId) => create().rememberWallet(walletId),
	forgetWallet: (walletId) => create().forgetWallet(walletId),
	getCachedState: () => create().getCachedState(),
	setCachedState: (wallets, accounts) =>
		create().setCachedState(wallets, accounts),
	destroy: () => create().destroy(),
});

const inertOnTheServer = (store: KheopskitStore): KheopskitStore =>
	typeof window === "undefined"
		? {
				...store,
				rememberWallet: () => {},
				forgetWallet: () => {},
				setCachedState: () => {},
			}
		: store;

/**
 * Creates one kheopskit instance: `kheopskit$`, the state stream every
 * subscriber shares, and `store`, which it reads the cache from and persists
 * into. Subscribe once at app start to keep it running for the page's
 * lifetime.
 *
 * @example
 * ```ts
 * export const { kheopskit$, store } = createKheopskit({ platforms: [polkadot()] });
 * kheopskit$.subscribe(render);
 * ```
 */
export const createKheopskit = <
	const P extends readonly [KheopskitPlatform, ...KheopskitPlatform[]],
>(
	config: CreateKheopskitConfig<P>,
	options: CreateKheopskitOptions = {},
): Kheopskit<P> => {
	const { storageKey } = resolveConfig(config);
	let created: KheopskitStore | undefined;
	const store = () => {
		created ??=
			options.store ??
			inertOnTheServer(
				createKheopskitStore({
					ssrCookies: options.ssr ? "" : undefined,
					storageKey,
				}),
			);
		return created;
	};
	return createInstance(
		() => kheopskitRun$(config, { store: store() }),
		options.store ?? lazyStore(store),
	);
};
