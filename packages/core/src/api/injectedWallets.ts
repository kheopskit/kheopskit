import {
	BehaviorSubject,
	combineLatest,
	distinctUntilChanged,
	map,
	Observable,
	shareReplay,
} from "rxjs";
import type { WalletId } from "../utils/WalletId";
import { abortedError, toConnectError } from "./errors";
import type { KheopskitStore } from "./store";
import type { BaseWallet, ConnectOptions } from "./types";

/**
 * Compare two wallet arrays by their relevant properties (not functions).
 * Shared by every platform's injected-wallets stream.
 */
const walletsEqual = <
	W extends Pick<BaseWallet, "id" | "isConnected" | "name">,
>(
	a: W[],
	b: W[],
): boolean => {
	if (a.length !== b.length) return false;
	return a.every(
		(w, i) =>
			w.id === b[i]?.id &&
			w.isConnected === b[i]?.isConnected &&
			w.name === b[i]?.name,
	);
};

/**
 * The platform-specific surface of an injected-wallets stream. Everything else
 * — the connect/disconnect state machine, the connected-ids bookkeeping, the
 * store persistence, change detection and sharing — is owned by
 * {@link createInjectedWallets$}.
 *
 * @typeParam TSource - a wallet as the platform's registry reports it
 * @typeParam TWallet - the platform's wallet type
 * @typeParam THandle - live connection handle retained while connected
 *   (Polkadot keeps the `InjectedExtension`; platforms with no handle use void)
 */
export type InjectedWalletsAdapter<
	TSource,
	TWallet extends BaseWallet,
	THandle = void,
> = {
	/** Live registry of the platform's injected wallets (emits `[]` during SSR). */
	sources$: Observable<readonly TSource[]>;
	/** Stable wallet id for a registry entry. */
	getWalletId: (source: TSource) => WalletId;
	/**
	 * Platform connect call (e.g. `connectInjectedExtension`,
	 * `eth_requestAccounts`, `standard:connect`). The resolved value is retained
	 * as the wallet's live handle until disconnect.
	 */
	connect: (source: TSource, walletId: WalletId) => Promise<THandle>;
	/** `true` maps the platform's rejection to `USER_REJECTED`; absent means never. */
	isUserRejection?: (error: unknown) => boolean;
	releaseAbandonedHandle?: (handle: THandle, walletId: WalletId) => void;
	/**
	 * Optional platform disconnect call, awaited before local state clears so a
	 * failed disconnect rejects without desyncing the connected list.
	 */
	disconnect?: (source: TSource, walletId: WalletId) => Promise<void>;
	/**
	 * Runs after a disconnect fully applied — the place to drop cached account
	 * observables so a later reconnect rebuilds them against a fresh handle.
	 */
	onDisconnected?: (walletId: WalletId) => void;
	/** Build the platform wallet object for one registry entry. */
	buildWallet: (args: {
		source: TSource;
		walletId: WalletId;
		/** Live connection handle; `undefined` while disconnected. */
		handle: THandle | undefined;
		isConnected: boolean;
		connect: (options?: ConnectOptions) => Promise<void>;
		disconnect: () => Promise<void>;
	}) => TWallet;
};

type Connecting = {
	status: "connecting";
	promise: Promise<void>;
	anchored: boolean;
	waiting: number;
	answered: boolean;
	abort: () => void;
};

type Connection<THandle> =
	| Connecting
	| { status: "connected"; handle: THandle; disconnecting?: Promise<void> };

const join = (
	connecting: Connecting,
	walletId: WalletId,
	signal: AbortSignal | undefined,
): Promise<void> => {
	if (!signal) {
		connecting.anchored = true;
		return connecting.promise;
	}
	connecting.waiting++;
	return new Promise<void>((resolve, reject) => {
		const leave = () => {
			if (connecting.answered) return;
			reject(abortedError(walletId));
			connecting.waiting--;
			if (!connecting.anchored && connecting.waiting === 0) connecting.abort();
		};
		signal.addEventListener("abort", leave, { once: true });
		connecting.promise
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", leave));
	});
};

/**
 * The shared engine behind every platform's injected-wallets stream: tracks
 * each wallet's connection (pending attempt or live handle), shares one
 * in-flight connect per wallet, persists connected ids to the store for
 * auto-reconnect, and re-emits the wallet list whenever the registry or
 * connection state changes.
 */
export const createInjectedWallets$ = <
	TSource,
	TWallet extends BaseWallet,
	THandle = void,
>(
	store: KheopskitStore,
	adapter: InjectedWalletsAdapter<TSource, TWallet, THandle>,
): Observable<TWallet[]> =>
	new Observable<TWallet[]>((subscriber) => {
		const connections$ = new BehaviorSubject<
			ReadonlyMap<WalletId, Connection<THandle>>
		>(new Map());
		const teardown = new AbortController();

		const setConnection = (
			walletId: WalletId,
			connection: Connection<THandle> | undefined,
		) => {
			const next = new Map(connections$.value);
			if (connection) next.set(walletId, connection);
			else next.delete(walletId);
			connections$.next(next);
		};

		const startConnect = (
			source: TSource,
			walletId: WalletId,
			signal: AbortSignal | undefined,
		): Promise<void> => {
			const controller = new AbortController();
			const promise = new Promise<void>((resolve, reject) => {
				controller.signal.addEventListener(
					"abort",
					() => {
						setConnection(walletId, undefined);
						reject(abortedError(walletId));
					},
					{ once: true },
				);
				new Promise<THandle>((res) =>
					res(adapter.connect(source, walletId)),
				).then(
					(handle) => {
						connecting.answered = true;
						if (controller.signal.aborted) {
							adapter.releaseAbandonedHandle?.(handle, walletId);
							return;
						}
						setConnection(walletId, { status: "connected", handle });
						resolve();
						store.rememberWallet(walletId);
					},
					(error) => {
						connecting.answered = true;
						if (controller.signal.aborted) return;
						setConnection(walletId, undefined);
						reject(
							toConnectError(
								error,
								walletId,
								adapter.isUserRejection ?? (() => false),
							),
						);
					},
				);
			});
			const connecting: Connecting = {
				status: "connecting",
				promise,
				anchored: false,
				waiting: 0,
				answered: false,
				abort: () => {
					if (connections$.value.get(walletId) === connecting)
						controller.abort();
				},
			};
			setConnection(walletId, connecting);
			return join(connecting, walletId, signal);
		};

		const untilSettled = (
			disconnecting: Promise<void>,
			walletId: WalletId,
			signal: AbortSignal | undefined,
		): Promise<void> =>
			new Promise<void>((resolve, reject) => {
				const signals = signal ? [teardown.signal, signal] : [teardown.signal];
				const settle = () => {
					for (const s of signals) s.removeEventListener("abort", settle);
					if (signals.some((s) => s.aborted)) reject(abortedError(walletId));
					else resolve();
				};
				if (signals.some((s) => s.aborted)) return settle();
				for (const s of signals)
					s.addEventListener("abort", settle, { once: true });
				disconnecting.then(settle, settle);
			});

		const connect = (
			source: TSource,
			walletId: WalletId,
			options?: ConnectOptions,
		): Promise<void> => {
			const current = connections$.value.get(walletId);
			if (current?.status === "connected") {
				if (!current.disconnecting) return Promise.resolve();
				return untilSettled(
					current.disconnecting,
					walletId,
					options?.signal,
				).then(() => connect(source, walletId, options));
			}
			if (options?.signal?.aborted)
				return Promise.reject(abortedError(walletId));
			if (current?.status === "connecting")
				return join(current, walletId, options?.signal);
			return startConnect(source, walletId, options?.signal);
		};

		const disconnect = (source: TSource, walletId: WalletId): Promise<void> => {
			const current = connections$.value.get(walletId);
			if (!current) return Promise.resolve();
			if (current.status === "connecting") {
				current.abort();
				return Promise.resolve();
			}
			if (current.disconnecting) return current.disconnecting;

			store.forgetWallet(walletId);
			const disconnecting = (async () => {
				try {
					await adapter.disconnect?.(source, walletId);
				} catch (error) {
					if (!teardown.signal.aborted) {
						setConnection(walletId, {
							status: "connected",
							handle: current.handle,
						});
						store.rememberWallet(walletId);
					}
					throw error;
				}
				if (teardown.signal.aborted) return;
				setConnection(walletId, undefined);
				adapter.onDisconnected?.(walletId);
			})();
			setConnection(walletId, { ...current, disconnecting });
			return disconnecting;
		};

		const sub = combineLatest([adapter.sources$, connections$])
			.pipe(
				map(([sources, connections]) =>
					sources.map((source): TWallet => {
						const walletId = adapter.getWalletId(source);
						const connection = connections.get(walletId);
						const connected =
							connection?.status === "connected" ? connection : undefined;
						return adapter.buildWallet({
							source,
							walletId,
							handle: connected?.handle,
							isConnected: connected !== undefined,
							connect: (options) => connect(source, walletId, options),
							disconnect: () => disconnect(source, walletId),
						});
					}),
				),
				distinctUntilChanged(walletsEqual),
			)
			.subscribe(subscriber);

		return () => {
			teardown.abort();
			for (const connection of connections$.value.values())
				if (connection.status === "connecting") connection.abort();
			sub.unsubscribe();
		};
	}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));
