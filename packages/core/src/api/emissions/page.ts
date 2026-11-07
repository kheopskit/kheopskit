import { vi } from "vitest";
import { clearAllCachedObservables } from "../../utils/getCachedObservable";
import type { SyncableStorage } from "../../utils/storage";
import { kheopskitRun$ } from "../kheopskit";
import { createKheopskitStore } from "../store";
import type {
	BaseWallet,
	BaseWalletAccount,
	KheopskitConfig,
	KheopskitState,
	WalletConnectWallet,
} from "../types";
import { personOf } from "./fakeWallets";

export type Frame = {
	isDiscovering?: true;
	isHydrating?: true;
	wallets: string[];
	accounts: string[];
};

const cachedSuffix = (item: { isPlaceholder?: boolean }) =>
	item.isPlaceholder ? " (cached)" : "";

const walletLabel = (wallet: BaseWallet | WalletConnectWallet) =>
	`${wallet.name}/${"platform" in wallet ? wallet.platform : "walletconnect"}`;

const accountLabel = (account: BaseWalletAccount) => {
	const { chainId } = account as { chainId?: number };
	const chain = chainId === undefined ? "" : ` @${chainId}`;
	return `${account.walletName}/${account.platform} ${personOf(account.address)}${chain}${cachedSuffix(account)}`;
};

const frameOf = (state: KheopskitState): Frame => ({
	...(state.isDiscovering && { isDiscovering: true }),
	...(state.isHydrating && { isHydrating: true }),
	wallets: state.wallets.map(
		(w) => `${walletLabel(w)} ${w.status}${cachedSuffix(w)}`,
	),
	accounts: state.accounts.map(accountLabel),
});

/** Long enough for discovery, hydration, every reconnect and the cache write to finish. */
export const settle = () => vi.advanceTimersByTimeAsync(5000);

const openPages = new Set<() => void>();

/**
 * Subscribes to `kheopskit$` as a freshly loaded page does and records every
 * emission as a `Frame`. Pages opened on the same `storage` share the
 * remembered wallets and the cached state, as reloads of one site do.
 */
export const openPage = (
	storage: SyncableStorage,
	config: Partial<KheopskitConfig>,
) => {
	const store = createKheopskitStore({ storage });
	const frames: Frame[] = [];
	let latest: KheopskitState | undefined;
	const subscription = kheopskitRun$(config, { store }).subscribe((state) => {
		latest = state;
		frames.push(frameOf(state));
	});
	const close = () => {
		openPages.delete(close);
		subscription.unsubscribe();
		store.destroy();
		clearAllCachedObservables();
	};
	openPages.add(close);

	return {
		frames,
		close,
		wallet: (label: string) => {
			const wallet = latest?.wallets.find((w) => walletLabel(w) === label);
			if (!wallet) throw new Error(`${label} is not listed`);
			return wallet;
		},
		/** The frames emitted while `act` runs and until everything settles. */
		framesDuring: async (act: () => unknown) => {
			await settle();
			const from = frames.length;
			const acted = Promise.resolve().then(act);
			acted.catch(() => {});
			await settle();
			await acted;
			return frames.slice(from);
		},
	};
};

export const closeAllPages = () => {
	for (const close of [...openPages]) close();
};
