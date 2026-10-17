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
	/** Recognises the platform's rejection of a refused connect prompt. */
	isUserRejection?: (error: unknown) => boolean;
	/**
	 * Drops a handle whose connect resolved after the attempt was abandoned
	 * (aborted, disconnected while pending, or torn down).
	 */
	release?: (handle: THandle, walletId: WalletId) => void;
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
	abort: () => void;
};

type Connection<THandle> =
	| Connecting
	| { status: "connected"; handle: THandle; disconnecting?: Promise<void> };

const followSignal = (signal: AbortSignal, connecting: Connecting) => {
	signal.addEventListener("abort", connecting.abort, { once: true });
	const stop = () => signal.removeEventListener("abort", connecting.abort);
	connecting.promise.then(stop, stop);
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
						if (controller.signal.aborted) {
							adapter.release?.(handle, walletId);
							return;
						}
						setConnection(walletId, { status: "connected", handle });
						store.addEnabledWalletId(walletId);
						resolve();
					},
					(error) => {
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
				abort: () => {
					if (connections$.value.get(walletId) === connecting)
						controller.abort();
				},
			};
			setConnection(walletId, connecting);
			if (signal) followSignal(signal, connecting);
			return promise;
		};

		const connect = (
			source: TSource,
			walletId: WalletId,
			options?: ConnectOptions,
		): Promise<void> => {
			const current = connections$.value.get(walletId);
			if (current?.status === "connected") {
				if (!current.disconnecting) return Promise.resolve();
				const retry = () => connect(source, walletId, options);
				return current.disconnecting.then(retry, retry);
			}
			if (options?.signal?.aborted)
				return Promise.reject(abortedError(walletId));
			if (current?.status === "connecting") {
				if (options?.signal) followSignal(options.signal, current);
				return current.promise;
			}
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

			const disconnecting = (async () => {
				try {
					await adapter.disconnect?.(source, walletId);
				} catch (error) {
					setConnection(walletId, {
						status: "connected",
						handle: current.handle,
					});
					throw error;
				}
				setConnection(walletId, undefined);
				store.removeEnabledWalletId(walletId);
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
			for (const connection of connections$.value.values())
				if (connection.status === "connecting") connection.abort();
			sub.unsubscribe();
		};
	}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));
