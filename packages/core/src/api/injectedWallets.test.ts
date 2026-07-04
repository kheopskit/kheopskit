import { BehaviorSubject, firstValueFrom } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletId } from "../utils/WalletId";
import {
	createInjectedWallets$,
	type InjectedWalletsAdapter,
} from "./injectedWallets";
import { createKheopskitStore } from "./store";
import type { BaseWallet } from "./types";

type FakeSource = { name: string };

const walletId = "polkadot:fake" as WalletId;

const makeAdapter = (
	sources$: BehaviorSubject<FakeSource[]>,
	overrides: Partial<
		InjectedWalletsAdapter<FakeSource, BaseWallet, string>
	> = {},
): InjectedWalletsAdapter<FakeSource, BaseWallet, string> => ({
	sources$,
	getWalletId: () => walletId,
	connect: vi.fn().mockResolvedValue("handle"),
	buildWallet: ({ walletId, handle, isConnected, connect, disconnect }) => ({
		id: walletId,
		platform: "polkadot",
		type: "injected",
		name: `Fake ${handle ?? ""}`.trim(),
		icon: "",
		isConnected,
		connect,
		disconnect,
	}),
	...overrides,
});

describe("createInjectedWallets$", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("emits disconnected wallets, then connected after connect()", async () => {
		const store = createKheopskitStore();
		const sources$ = new BehaviorSubject<FakeSource[]>([{ name: "fake" }]);
		const wallets$ = createInjectedWallets$(store, makeAdapter(sources$));

		const emissions: boolean[][] = [];
		const sub = wallets$.subscribe((wallets) =>
			emissions.push(wallets.map((w) => w.isConnected)),
		);

		expect(emissions.at(-1)).toEqual([false]);

		const wallet = (await firstValueFrom(wallets$))[0];
		await wallet?.connect();

		expect(emissions.at(-1)).toEqual([true]);
		// Connected id persisted for auto-reconnect
		expect(
			JSON.parse(localStorage.getItem("kheopskit") || "{}").autoReconnect,
		).toContain(walletId);

		sub.unsubscribe();
	});

	it("guards double connect and double disconnect", async () => {
		const store = createKheopskitStore();
		const sources$ = new BehaviorSubject<FakeSource[]>([{ name: "fake" }]);
		const wallets$ = createInjectedWallets$(store, makeAdapter(sources$));
		const sub = wallets$.subscribe();

		const first = (await firstValueFrom(wallets$))[0];
		await first?.connect();
		const connected = (await firstValueFrom(wallets$))[0];

		await expect(connected?.connect()).rejects.toMatchObject({
			code: "WALLET_ALREADY_CONNECTED",
		});

		await connected?.disconnect();
		const disconnected = (await firstValueFrom(wallets$))[0];
		await expect(disconnected?.disconnect()).rejects.toMatchObject({
			code: "WALLET_NOT_CONNECTED",
		});

		sub.unsubscribe();
	});

	it("runs platform disconnect before clearing state and onDisconnected after", async () => {
		const store = createKheopskitStore();
		const sources$ = new BehaviorSubject<FakeSource[]>([{ name: "fake" }]);
		const calls: string[] = [];
		const adapter = makeAdapter(sources$, {
			disconnect: async () => {
				calls.push("platform-disconnect");
			},
			onDisconnected: () => calls.push("on-disconnected"),
		});
		const wallets$ = createInjectedWallets$(store, adapter);
		const sub = wallets$.subscribe();

		const wallet = (await firstValueFrom(wallets$))[0];
		await wallet?.connect();
		await (await firstValueFrom(wallets$))[0]?.disconnect();

		expect(calls).toEqual(["platform-disconnect", "on-disconnected"]);
		expect(
			JSON.parse(localStorage.getItem("kheopskit") || "{}").autoReconnect,
		).not.toContain(walletId);

		sub.unsubscribe();
	});

	it("exposes the connect handle to buildWallet while connected", async () => {
		const store = createKheopskitStore();
		const sources$ = new BehaviorSubject<FakeSource[]>([{ name: "fake" }]);
		const wallets$ = createInjectedWallets$(store, makeAdapter(sources$));
		const sub = wallets$.subscribe();

		await (await firstValueFrom(wallets$))[0]?.connect();
		const connected = (await firstValueFrom(wallets$))[0];
		expect(connected?.name).toBe("Fake handle");

		sub.unsubscribe();
	});

	it("does not re-emit when the wallet list is unchanged", async () => {
		const store = createKheopskitStore();
		const sources$ = new BehaviorSubject<FakeSource[]>([{ name: "fake" }]);
		const wallets$ = createInjectedWallets$(store, makeAdapter(sources$));

		let emissions = 0;
		const sub = wallets$.subscribe(() => {
			emissions++;
		});

		sources$.next([{ name: "fake" }]); // same id/name/isConnected
		expect(emissions).toBe(1);

		sub.unsubscribe();
	});
});
