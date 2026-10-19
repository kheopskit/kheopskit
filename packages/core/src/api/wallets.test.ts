import {
	BehaviorSubject,
	firstValueFrom,
	of,
	type Subscription,
	take,
} from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncableStorage } from "../utils/storage";
import type { WalletId } from "../utils/WalletId";
import { resolveConfig } from "./config";
import {
	createInjectedWallets$,
	type InjectedWalletsAdapter,
} from "./injectedWallets";
import { kheopskitRun$ } from "./kheopskit";
import { createKheopskitStore } from "./store";
import type {
	AppKitInstance,
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

const spiedStorage = () => ({
	getItem: (key: string) => localStorage.getItem(key),
	setItem: vi.fn((key: string, value: string) =>
		localStorage.setItem(key, value),
	),
	removeItem: (key: string) => localStorage.removeItem(key),
});

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
		storage = undefined as SyncableStorage | undefined,
		onEmission = (_wallets: BaseWallet[]) => {},
	} = {}) => {
		const store = createKheopskitStore({ storage });
		for (const id of rememberedIds) store.rememberWallet(id);
		const sources$ = new BehaviorSubject<Source[]>(sources);
		const connect = vi.fn(adapter.connect ?? (async () => "handle"));
		const config = resolveConfig({
			platforms: [enginePlugin(sources$, { ...adapter, connect })],
			autoReconnect,
			debug: false,
		});
		const emissions: BaseWallet[][] = [];
		sub = getWallets$(config, store).subscribe((wallets) => {
			emissions.push(wallets as BaseWallet[]);
			onEmission(wallets as BaseWallet[]);
		});
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
		const { walletById } = setup({
			adapter: { connect: () => deferred.promise },
		});

		await flush();
		expect([
			walletById(walletA).status,
			walletById(walletA).isConnected,
		]).toEqual(["connecting", false]);

		deferred.resolve("handle");
		await flush();
		expect([
			walletById(walletA).status,
			walletById(walletA).isConnected,
		]).toEqual(["connected", true]);
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

	it("a rejection handled after the last subscriber left writes nothing to storage", async () => {
		const storage = spiedStorage();
		let writesAtUnsubscribe: number | undefined;
		const { connect } = setup({
			storage,
			adapter: {
				connect: () => Promise.reject(new Error("refused")),
				isUserRejection: () => true,
			},
			onEmission: (wallets) => {
				if (wallets[0]?.error?.code !== "USER_REJECTED") return;
				writesAtUnsubscribe = storage.setItem.mock.calls.length;
				sub?.unsubscribe();
			},
		});

		await flush();
		await flush();
		expect(connectedIds(connect.mock.calls)).toEqual([walletA]);
		expect(writesAtUnsubscribe).toBe(1);
		expect(storage.setItem.mock.calls.length).toBe(1);
		expect(remembered()).toEqual([walletA]);
	});

	it("a disconnect during a pending auto-reconnect is not undone by a later wallets emission", async () => {
		const deferred = createDeferred();
		let calls = 0;
		const { connect, walletById, sources$ } = setup({
			adapter: {
				connect: () =>
					++calls === 1 ? deferred.promise : Promise.resolve("handle"),
			},
		});

		await flush();
		expect(walletById(walletA).status).toBe("connecting");
		await walletById(walletA).disconnect();
		await flush();
		expect(walletById(walletA).status).toBe("disconnected");

		sources$.next([{ id: walletA }, { id: walletB }]);
		await flush();
		expect(connectedIds(connect.mock.calls)).toEqual([walletA]);
		expect(walletById(walletA).status).toBe("disconnected");
	});

	it("a user disconnect after a failed auto-reconnect and a manual connect is not undone", async () => {
		let calls = 0;
		const { connect, walletById } = setup({
			adapter: {
				connect: () =>
					++calls === 1
						? Promise.reject(new Error("locked"))
						: Promise.resolve("handle"),
			},
		});

		await flush();
		expect(walletById(walletA).error?.code).toBe("CONNECT_FAILED");
		await walletById(walletA).connect();
		await flush();
		expect(walletById(walletA).status).toBe("connected");

		await walletById(walletA).disconnect();
		await flush();
		await flush();
		expect(connectedIds(connect.mock.calls)).toEqual([walletA, walletA]);
		expect(walletById(walletA).status).toBe("disconnected");
		expect(remembered()).toEqual([]);
	});

	it("a user disconnect after a failed auto-reconnect is not undone by a later wallets emission", async () => {
		const { connect, walletById, sources$ } = setup({
			adapter: { connect: () => Promise.reject(new Error("locked")) },
		});

		await flush();
		expect(walletById(walletA).error?.code).toBe("CONNECT_FAILED");
		await walletById(walletA).disconnect();
		await flush();

		sources$.next([{ id: walletA }, { id: walletB }]);
		await flush();
		expect(connectedIds(connect.mock.calls)).toEqual([walletA]);
		expect(walletById(walletA).status).toBe("disconnected");
	});

	it("after a failed auto-reconnect, a manual connect the user refuses is not followed by an automatic prompt", async () => {
		let calls = 0;
		const { connect, walletById, sources$ } = setup({
			adapter: {
				connect: () =>
					Promise.reject(new Error(++calls === 1 ? "locked" : "refused")),
				isUserRejection: (error) =>
					error instanceof Error && error.message === "refused",
			},
		});

		await flush();
		expect(walletById(walletA).error?.code).toBe("CONNECT_FAILED");
		await expect(walletById(walletA).connect()).rejects.toMatchObject({
			code: "USER_REJECTED",
		});
		await flush();
		expect(walletById(walletA).error?.code).toBe("USER_REJECTED");

		sources$.next([{ id: walletA }, { id: walletB }]);
		await flush();
		expect(connectedIds(connect.mock.calls)).toEqual([walletA, walletA]);
		expect(walletById(walletA).status).toBe("disconnected");
	});

	type Attempt = {
		resolve: (handle: string) => void;
		reject: (error: Error) => void;
	};

	const autoReconnectAnsweredAfterTwoDiscoveryChanges = async ({
		manualConnect,
		answer,
	}: {
		manualConnect: boolean;
		answer: (attempt: Attempt) => void;
	}) => {
		const attempts: Attempt[] = [];
		const { connect, walletById, sources$ } = setup({
			adapter: {
				connect: () =>
					new Promise<string>((resolve, reject) => {
						attempts.push({ resolve, reject });
					}),
				isUserRejection: (error) =>
					error instanceof Error && error.message === "refused",
			},
		});

		await flush();
		expect(walletById(walletA).status).toBe("connecting");
		const manual = manualConnect
			? walletById(walletA)
					.connect()
					.then(
						() => "resolved",
						(error) => `rejected ${error.code}`,
					)
			: Promise.resolve("none");
		await flush();
		expect(attempts).toHaveLength(1);
		const [attempt] = attempts;
		if (!attempt) throw new Error("no pending attempt");
		answer(attempt);
		await flush();

		sources$.next([{ id: walletA }, { id: walletB }]);
		await flush();
		sources$.next([{ id: walletA }, { id: walletB }, { id: walletC }]);
		await flush();
		return {
			manual: await manual,
			calls: connectedIds(connect.mock.calls),
			status: walletById(walletA).status,
			remembered: remembered(),
		};
	};

	it("an auto-reconnect that fails with nobody joining it is retried on the next discovery change", async () => {
		const result = await autoReconnectAnsweredAfterTwoDiscoveryChanges({
			manualConnect: false,
			answer: (attempt) => attempt.reject(new Error("locked")),
		});
		expect(result).toEqual({
			manual: "none",
			calls: [walletA, walletA],
			status: "connecting",
			remembered: [walletA],
		});
	});

	it("a manual connect that joins a pending auto-reconnect which then fails ends automatic reconnect for the session", async () => {
		const result = await autoReconnectAnsweredAfterTwoDiscoveryChanges({
			manualConnect: true,
			answer: (attempt) => attempt.reject(new Error("locked")),
		});
		expect(result).toEqual({
			manual: "rejected CONNECT_FAILED",
			calls: [walletA],
			status: "disconnected",
			remembered: [walletA],
		});
	});

	it("a manual connect that joins a pending auto-reconnect the user refuses forgets the wallet and prompts no more", async () => {
		const result = await autoReconnectAnsweredAfterTwoDiscoveryChanges({
			manualConnect: true,
			answer: (attempt) => attempt.reject(new Error("refused")),
		});
		expect(result).toEqual({
			manual: "rejected USER_REJECTED",
			calls: [walletA],
			status: "disconnected",
			remembered: [],
		});
	});

	it("a manual connect that joins a pending auto-reconnect which is granted leaves the wallet connected and prompts no more", async () => {
		const result = await autoReconnectAnsweredAfterTwoDiscoveryChanges({
			manualConnect: true,
			answer: (attempt) => attempt.resolve("handle"),
		});
		expect(result).toEqual({
			manual: "resolved",
			calls: [walletA],
			status: "connected",
			remembered: [walletA],
		});
	});

	it("a remembered wallet whose source leaves during its auto-reconnect and returns stays remembered and is not re-attempted", async () => {
		const deferred = createDeferred();
		const { connect, walletById, sources$ } = setup({
			adapter: { connect: () => deferred.promise },
		});

		await flush();
		expect(walletById(walletA).status).toBe("connecting");
		sources$.next([]);
		await flush();
		sources$.next([{ id: walletA }]);
		await flush();
		sources$.next([{ id: walletA }, { id: walletB }]);
		await flush();
		expect(connectedIds(connect.mock.calls)).toEqual([walletA]);
		expect(walletById(walletA).status).toBe("disconnected");
		expect(remembered()).toEqual([walletA]);
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

	it("a remembered wallet discovered after subscribe shows connecting while its reconnect pends", async () => {
		const deferred = createDeferred();
		const { connect, walletById, sources$ } = setup({
			sources: [],
			adapter: { connect: () => deferred.promise },
		});

		await flush();
		sources$.next([{ id: walletA }]);
		await flush();
		expect(connectedIds(connect.mock.calls)).toEqual([walletA]);
		expect(walletById(walletA).status).toBe("connecting");

		deferred.resolve("handle");
		await flush();
		expect(walletById(walletA).status).toBe("connected");
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

	it("a subscriber that leaves on the first emission starts no reconnect", async () => {
		const store = createKheopskitStore();
		store.rememberWallet(walletA);
		const connect = vi.fn(async () => "handle");
		const config = resolveConfig({
			platforms: [
				enginePlugin(new BehaviorSubject([{ id: walletA }]), { connect }),
			],
			autoReconnect: true,
			debug: false,
		});
		const emissions: BaseWallet[][] = [];
		getWallets$(config, store)
			.pipe(take(1))
			.subscribe((wallets) => emissions.push(wallets as BaseWallet[]));
		expect(emissions.map((ws) => ws.map((w) => w.status))).toEqual([
			["disconnected"],
		]);
		expect(connect).not.toHaveBeenCalled();

		await flush();
		expect(connect).not.toHaveBeenCalled();
	});
});

describe("getWallets$ WalletConnect connector", () => {
	const fakeConnector = {
		id: "walletconnect" as WalletId,
		type: "walletconnect",
		platforms: [],
		appKit: {} as AppKitInstance,
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

describe("kheopskitRun$ with a cached connected wallet discovered after subscribe", () => {
	const wait = (ms: number) =>
		new Promise((resolve) => setTimeout(resolve, ms));

	it("stays connecting until its reconnect settles, then connected", async () => {
		localStorage.clear();
		const store = createKheopskitStore();
		store.rememberWallet(walletA);
		store.setCachedState(
			[
				{
					id: walletA,
					platform: "polkadot",
					type: "injected",
					name: "A",
					isConnected: true,
				},
			],
			[],
		);
		const sources$ = new BehaviorSubject<Source[]>([]);
		const deferred = createDeferred();
		const statuses: (string | undefined)[] = [];
		const sub = kheopskitRun$(
			{
				platforms: [
					enginePlugin(sources$, { connect: () => deferred.promise }),
				],
				hydrationGracePeriod: 500,
			},
			{ store },
		).subscribe((state) => {
			statuses.push(state.wallets.find((w) => w.id === walletA)?.status);
		});

		await wait(50);
		sources$.next([{ id: walletA }]);
		await wait(50);
		expect(statuses.at(-1)).toBe("connecting");

		deferred.resolve("handle");
		await wait(50);
		sub.unsubscribe();
		expect(
			statuses.filter((status, i, all) => i === 0 || status !== all[i - 1]),
		).toEqual(["connecting", "connected"]);
	});
});
