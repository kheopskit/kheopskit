import { BehaviorSubject, firstValueFrom, of, type Subscription } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletId } from "../utils/WalletId";
import { resolveConfig } from "./config";
import {
	createInjectedWallets$,
	type InjectedWalletsAdapter,
} from "./injectedWallets";
import { createKheopskitStore } from "./store";
import type {
	BaseWallet,
	KheopskitConfig,
	KheopskitPlatform,
	WalletConnectPlugin,
	WalletConnectWallet,
} from "./types";
import { getWallets$ } from "./wallets";

type Source = { id: WalletId; name?: string };

const walletA = "polkadot:a" as WalletId;
const walletB = "polkadot:b" as WalletId;
const walletC = "polkadot:c" as WalletId;

type Adapter = InjectedWalletsAdapter<Source, BaseWallet, string>;

const enginePlugin = (
	sources$: BehaviorSubject<Source[]>,
	adapter: Partial<Adapter>,
): KheopskitPlatform => ({
	platform: "polkadot",
	getWallets$: (ctx) =>
		createInjectedWallets$<Source, BaseWallet, string>(ctx.store, {
			sources$,
			getWalletId: (source) => source.id,
			connect: async () => "handle",
			buildWallet: ({
				source,
				walletId,
				status,
				error,
				isConnected,
				connect,
				disconnect,
			}) => ({
				id: walletId,
				platform: "polkadot",
				type: "injected",
				name: source.name ?? walletId,
				icon: "",
				status,
				error,
				isConnected,
				connect,
				disconnect,
			}),
			...adapter,
		}),
	getAccounts$: () => of([]),
});

const createDeferred = () => {
	let resolve!: (value: string) => void;
	const promise = new Promise<string>((res) => {
		resolve = res;
	});
	return { promise, resolve };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const remembered = (): string[] =>
	JSON.parse(localStorage.getItem("kheopskit") || "{}").remembered ?? [];

const connectedIds = (calls: unknown[][]) =>
	calls.map(([, walletId]) => walletId);

describe("getWallets$ auto-reconnect", () => {
	let sub: Subscription | undefined;

	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		sub?.unsubscribe();
		sub = undefined;
		vi.restoreAllMocks();
	});

	const setup = ({
		rememberedIds = [walletA],
		sources = [{ id: walletA }] as Source[],
		adapter = {} as Partial<Adapter>,
		autoReconnect = true as KheopskitConfig["autoReconnect"],
	} = {}) => {
		const store = createKheopskitStore();
		for (const id of rememberedIds) store.rememberWallet(id);
		const sources$ = new BehaviorSubject<Source[]>(sources);
		const connect = vi.fn(adapter.connect ?? (async () => "handle"));
		const config = resolveConfig({
			platforms: [enginePlugin(sources$, { ...adapter, connect })],
			autoReconnect,
			debug: false,
		});
		const emissions: BaseWallet[][] = [];
		sub = getWallets$(config, store).subscribe((wallets) =>
			emissions.push(wallets as BaseWallet[]),
		);
		const walletById = (id: WalletId) => {
			const wallet = emissions.at(-1)?.find((w) => w.id === id);
			if (!wallet) throw new Error(`wallet ${id} not emitted`);
			return wallet;
		};
		return { store, sources$, connect, emissions, walletById };
	};

	it("reconnects wallets listed in the store's remembered ids", async () => {
		const { connect } = setup();

		await flush();
		expect(connectedIds(connect.mock.calls)).toEqual([walletA]);
	});

	it("does not reconnect when config.autoReconnect is false", async () => {
		const { connect, walletById } = setup({ autoReconnect: false });

		await flush();
		expect(connect).not.toHaveBeenCalled();
		expect(walletById(walletA).status).toBe("disconnected");
	});

	it("a remembered wallet shows connecting while it reconnects, then connected", async () => {
		const deferred = createDeferred();
		const { emissions } = setup({
			adapter: { connect: () => deferred.promise },
		});

		await flush();
		expect(emissions.map((wallets) => wallets[0]?.status)).toEqual([
			"connecting",
		]);
		expect(emissions[0]?.[0]?.isConnected).toBe(false);

		deferred.resolve("handle");
		await flush();
		expect(emissions.map((wallets) => wallets[0]?.status)).toEqual([
			"connecting",
			"connected",
		]);
		expect(emissions[1]?.[0]?.isConnected).toBe(true);
	});

	it("a reconnect that fails sets error and keeps the wallet remembered", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const { connect, sources$, walletById } = setup({
			adapter: { connect: () => Promise.reject(new Error("locked")) },
		});

		await flush();
		expect(walletById(walletA).status).toBe("disconnected");
		expect(walletById(walletA).error?.code).toBe("CONNECT_FAILED");
		expect(walletById(walletA).error?.cause).toEqual(new Error("locked"));
		expect(remembered()).toEqual([walletA]);
		expect(connectedIds(connect.mock.calls)).toEqual([walletA]);
		expect(consoleError).not.toHaveBeenCalled();

		sources$.next([{ id: walletA }, { id: walletB }]);
		await flush();
		expect(connectedIds(connect.mock.calls)).toEqual([walletA, walletA]);
	});

	it("a reconnect the user rejects forgets the wallet and never retries", async () => {
		const { connect, sources$, walletById } = setup({
			adapter: {
				connect: () => Promise.reject(new Error("refused")),
				isUserRejection: () => true,
			},
		});

		await flush();
		expect(walletById(walletA).status).toBe("disconnected");
		expect(walletById(walletA).error?.code).toBe("USER_REJECTED");
		expect(remembered()).toEqual([]);

		sources$.next([{ id: walletA }, { id: walletB }]);
		await flush();
		expect(connectedIds(connect.mock.calls)).toEqual([walletA]);
	});

	it("reconnects only wallets the predicate accepts", async () => {
		const { connect, walletById } = setup({
			rememberedIds: [walletA, walletB],
			sources: [{ id: walletA }, { id: walletB }],
			autoReconnect: (wallet) => wallet.id === walletB,
		});

		await flush();
		expect(connectedIds(connect.mock.calls)).toEqual([walletB]);
		expect(walletById(walletA).status).toBe("disconnected");
		expect(walletById(walletB).status).toBe("connected");
	});

	it("attempts a remembered wallet discovered after the first emission", async () => {
		const { connect, sources$ } = setup({
			rememberedIds: [walletA, walletB],
			sources: [{ id: walletA }],
		});

		await flush();
		expect(connectedIds(connect.mock.calls)).toEqual([walletA]);

		sources$.next([{ id: walletA }, { id: walletB }]);
		await flush();
		expect(connectedIds(connect.mock.calls)).toEqual([walletA, walletB]);
	});

	it("does not auto-connect a wallet remembered by another tab after subscribe", async () => {
		const { connect, sources$, store } = setup({
			rememberedIds: [walletA],
			sources: [{ id: walletA }, { id: walletB }],
		});

		await flush();
		store.rememberWallet(walletB);
		sources$.next([{ id: walletA }, { id: walletB }, { id: walletC }]);
		await flush();

		expect(connectedIds(connect.mock.calls)).toEqual([walletA]);
	});

	it("does not retry a wallet that keeps re-emitting after it reconnected", async () => {
		const { connect, sources$, walletById } = setup();

		await flush();
		sources$.next([{ id: walletA, name: "Renamed" }]);
		await flush();

		expect(walletById(walletA).name).toBe("Renamed");
		expect(walletById(walletA).status).toBe("connected");
		expect(connectedIds(connect.mock.calls)).toEqual([walletA]);
	});

	it("emits the plugin wallets", async () => {
		const store = createKheopskitStore();
		const config = resolveConfig({
			platforms: [enginePlugin(new BehaviorSubject([{ id: walletA }]), {})],
			autoReconnect: false,
		});
		const wallets = await firstValueFrom(getWallets$(config, store));
		expect(wallets.map((w) => w.id)).toEqual([walletA]);
	});
});

describe("getWallets$ WalletConnect connector", () => {
	const fakeConnector = {
		id: "walletconnect" as WalletId,
		type: "walletconnect",
		platforms: [],
		appKit: {} as WalletConnectWallet["appKit"],
		name: "A WalletConnect wallet",
		icon: "",
		status: "disconnected",
		isConnected: false,
		connect: async () => {},
		disconnect: async () => {},
	} satisfies WalletConnectWallet;

	const fakePlugin = {
		type: "walletconnect",
		metadata: { name: "Test Dapp", description: "", url: "", icons: [] },
		getWallet$: () => of(fakeConnector),
	} satisfies WalletConnectPlugin;

	const platformSources = () =>
		new BehaviorSubject<Source[]>([
			{ id: walletB, name: "B" },
			{ id: walletA, name: "A" },
		]);

	beforeEach(() => {
		localStorage.clear();
	});

	it("appends the plugin's connector after the platform wallets", async () => {
		const config = resolveConfig({
			platforms: [enginePlugin(platformSources(), {})],
			walletConnect: fakePlugin,
			autoReconnect: false,
		});

		const wallets = await firstValueFrom(
			getWallets$(config, createKheopskitStore()),
		);

		expect(wallets.map((w) => w.id)).toEqual([
			"polkadot:a",
			"polkadot:b",
			"walletconnect",
		]);
	});

	it("lists no WalletConnect connector without walletConnect", async () => {
		const config = resolveConfig({
			platforms: [enginePlugin(platformSources(), {})],
			autoReconnect: false,
		});

		const wallets = await firstValueFrom(
			getWallets$(config, createKheopskitStore()),
		);

		expect(wallets.map((w) => w.id)).toEqual(["polkadot:a", "polkadot:b"]);
		expect(wallets.filter((w) => w.type === "walletconnect")).toEqual([]);
	});
});
