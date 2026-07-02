import { BehaviorSubject, firstValueFrom, of } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletId } from "../utils/WalletId";
import { resolveConfig } from "./config";
import { createKheopskitStore } from "./store";
import type { BaseWallet, KheopskitPlatform } from "./types";

vi.mock("./appKit", () => ({
	getWalletConnectWallet$: vi.fn(() => of(null)),
}));

const walletId = "polkadot:test" as WalletId;

const makeWallet = (overrides: Partial<BaseWallet> = {}): BaseWallet => ({
	id: walletId,
	platform: "polkadot",
	type: "injected",
	name: "Test Wallet",
	icon: "",
	isConnected: false,
	connect: vi.fn().mockResolvedValue(undefined),
	disconnect: vi.fn().mockResolvedValue(undefined),
	...overrides,
});

const makePlugin = (
	wallets$: BehaviorSubject<BaseWallet[]>,
): KheopskitPlatform => ({
	platform: "polkadot",
	getWallets$: () => wallets$,
	getAccounts$: () => of([]),
});

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("getWallets$ auto-reconnect", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	const setup = async (configOverrides: { autoReconnect?: boolean } = {}) => {
		const store = createKheopskitStore();
		store.addEnabledWalletId(walletId);
		const wallet = makeWallet();
		const wallets$ = new BehaviorSubject<BaseWallet[]>([wallet]);
		const config = resolveConfig({
			platforms: [makePlugin(wallets$)],
			debug: false,
			...configOverrides,
		});
		const { getWallets$ } = await import("./wallets");
		return { store, wallet, wallets$, live$: getWallets$(config, store) };
	};

	it("reconnects wallets listed in the store's autoReconnect ids", async () => {
		const { wallet, live$ } = await setup();

		const sub = live$.subscribe();
		await flushMicrotasks();
		expect(wallet.connect).toHaveBeenCalledTimes(1);
		sub.unsubscribe();
	});

	it("does not reconnect when config.autoReconnect is false", async () => {
		const { wallet, live$ } = await setup({ autoReconnect: false });

		const sub = live$.subscribe();
		await flushMicrotasks();
		expect(wallet.connect).not.toHaveBeenCalled();
		sub.unsubscribe();
	});

	it("does not retry a wallet that keeps re-emitting after it reconnected", async () => {
		const { wallet, wallets$, live$ } = await setup();

		const sub = live$.subscribe();
		await flushMicrotasks();

		// Wallet re-emits (e.g. registry event) still flagged disconnected: the
		// policy remembers the successful reconnect and must not connect again.
		wallets$.next([makeWallet({ connect: wallet.connect })]);
		await flushMicrotasks();

		expect(wallet.connect).toHaveBeenCalledTimes(1);
		sub.unsubscribe();
	});

	it("emits the plugin wallets", async () => {
		const { live$ } = await setup({ autoReconnect: false });
		const wallets = await firstValueFrom(live$);
		expect(wallets.map((w) => w.id)).toEqual([walletId]);
	});
});
