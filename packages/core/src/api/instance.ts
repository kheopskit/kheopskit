import { defer, map, type Observable, ReplaySubject, share } from "rxjs";
import type { WalletId } from "../utils/WalletId";
import { resolveConfig } from "./config";
import { kheopskitRun$ } from "./kheopskit";
import {
	createPresenter,
	type WalletActions,
	walletActions,
} from "./liveActions";
import { createLivePipeline } from "./livePipeline";
import { createKheopskitStore } from "./store";
import type {
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
	// K17: readonly waitForAccount: (accountId: WalletAccountId, options?: { signal?: AbortSignal }) => Promise<...>;
};

type KheopskitInternals = {
	/** Gives a snapshot that `kheopskit$` did not emit the same actions. */
	present: (state: KheopskitState) => KheopskitState;
	/** Actions for a wallet id the state may not list yet. */
	walletActions: (walletId: WalletId) => WalletActions;
};

const internals = new WeakMap<object, KheopskitInternals>();

/**
 * The instance over any run source: one shared run per holder period, its
 * liveness, and the presenter that gives every emitted wallet call-time
 * actions.
 */
export const createInstance = <T extends KheopskitState>(
	run$: () => Observable<T>,
	store: KheopskitStore,
): { readonly kheopskit$: Observable<T>; readonly store: KheopskitStore } => {
	const pipeline = createLivePipeline<KheopskitState>(
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
	const kit = {
		// The presenter only swaps each wallet's actions for ones of the same type.
		kheopskit$: pipeline.observable$.pipe(map(present)) as Observable<T>,
		store,
	};
	internals.set(kit, {
		present,
		walletActions: (walletId) => walletActions(pipeline, walletId),
	});
	return kit;
};

/** @internal */
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

// A module-level instance outlives every request on the server, so no request
// may change what its store holds there.
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
