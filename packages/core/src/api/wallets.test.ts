import { BehaviorSubject, firstValueFrom, of } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createFakePolkadotExtension,
	createMemoryStorage,
	type FakePolkadotExtension,
} from "../testing";
import { resolveConfig } from "./config";
import { polkadot } from "./polkadot/plugin";
import { createKheopskitStore } from "./store";
import type { BaseWallet, KheopskitPlatform } from "./types";
import { getWallets$ } from "./wallets";

vi.mock("./appKit", () => ({
	getWalletConnectWallet$: vi.fn(() => of(null)),
}));

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("getWallets$ auto-reconnect", () => {
	let talisman: FakePolkadotExtension;

	afterEach(() => {
		talisman.uninstall();
	});

	const setup = (configOverrides: { autoReconnect?: boolean } = {}) => {
		talisman = createFakePolkadotExtension({ name: "talisman" });
		const store = createKheopskitStore({ storage: createMemoryStorage() });
		store.rememberWallet(talisman.walletId);
		const config = resolveConfig({
			platforms: [polkadot()],
			debug: false,
			...configOverrides,
		});
		return getWallets$(config, store);
	};

	it("reconnects wallets listed in the store's remembered ids", async () => {
		const sub = setup().subscribe();
		await flushMicrotasks();

		expect(talisman.enableCalls()).toHaveLength(1);
		sub.unsubscribe();
	});

	it("does not reconnect when config.autoReconnect is false", async () => {
		const sub = setup({ autoReconnect: false }).subscribe();
		await flushMicrotasks();

		expect(talisman.enableCalls()).toEqual([]);
		sub.unsubscribe();
	});

	it("emits the plugin wallets", async () => {
		const wallets = await firstValueFrom(setup({ autoReconnect: false }));

		expect(wallets.map((w) => w.id)).toEqual(["polkadot:talisman"]);
	});
});

describe("getWallets$ reconnect policy", () => {
	it("does not retry a wallet that keeps re-emitting after it reconnected", async () => {
		const connect = vi.fn().mockResolvedValue(undefined);
		const disconnected: BaseWallet = {
			id: "polkadot:test",
			platform: "polkadot",
			type: "injected",
			name: "Test Wallet",
			icon: "",
			isConnected: false,
			connect,
			disconnect: vi.fn().mockResolvedValue(undefined),
		};
		const wallets$ = new BehaviorSubject<BaseWallet[]>([disconnected]);
		const plugin: KheopskitPlatform = {
			platform: "polkadot",
			getWallets$: () => wallets$,
			getAccounts$: () => of([]),
		};
		const store = createKheopskitStore({ storage: createMemoryStorage() });
		store.rememberWallet(disconnected.id);

		const sub = getWallets$(
			resolveConfig({ platforms: [plugin], debug: false }),
			store,
		).subscribe();
		await flushMicrotasks();
		wallets$.next([{ ...disconnected }]);
		await flushMicrotasks();

		expect(connect).toHaveBeenCalledTimes(1);
		sub.unsubscribe();
	});
});
