import {
	BehaviorSubject,
	combineLatest,
	distinctUntilChanged,
	map,
	Observable,
	shareReplay,
} from "rxjs";
import type { WalletId } from "../utils/WalletId";
import { KheopskitError } from "./errors";
import type { KheopskitStore } from "./store";
import type { BaseWallet } from "./types";

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
		connect: () => Promise<void>;
		disconnect: () => Promise<void>;
	}) => TWallet;
};

/**
 * The shared engine behind every platform's injected-wallets stream: tracks
 * connected wallets (and their live handles), guards double
 * connect/disconnect, persists connected ids to the store for auto-reconnect,
 * and re-emits the wallet list whenever the registry or connection state
 * changes.
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
		const handles$ = new BehaviorSubject<Map<WalletId, THandle>>(new Map());

		const connect = async (source: TSource, walletId: WalletId) => {
			if (handles$.value.has(walletId))
				throw new KheopskitError(
					"WALLET_ALREADY_CONNECTED",
					`wallet ${walletId} is already connected`,
					{ walletId },
				);

			const handle = await adapter.connect(source, walletId);

			const next = new Map(handles$.value);
			next.set(walletId, handle);
			handles$.next(next);

			store.addEnabledWalletId(walletId);
		};

		const disconnect = async (source: TSource, walletId: WalletId) => {
			if (!handles$.value.has(walletId))
				throw new KheopskitError(
					"WALLET_NOT_CONNECTED",
					`wallet ${walletId} is not connected`,
					{ walletId },
				);

			await adapter.disconnect?.(source, walletId);

			const next = new Map(handles$.value);
			next.delete(walletId);
			handles$.next(next);

			store.removeEnabledWalletId(walletId);

			adapter.onDisconnected?.(walletId);
		};

		const sub = combineLatest([adapter.sources$, handles$])
			.pipe(
				map(([sources, handles]) =>
					sources.map((source): TWallet => {
						const walletId = adapter.getWalletId(source);
						return adapter.buildWallet({
							source,
							walletId,
							handle: handles.get(walletId),
							isConnected: handles.has(walletId),
							connect: () => connect(source, walletId),
							disconnect: () => disconnect(source, walletId),
						});
					}),
				),
				distinctUntilChanged(walletsEqual),
			)
			.subscribe(subscriber);

		return () => {
			sub.unsubscribe();
		};
	}).pipe(shareReplay({ refCount: true, bufferSize: 1 }));
