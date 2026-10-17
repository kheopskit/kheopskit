import { announceProvider, type EIP6963ProviderDetail } from "mipd";
import { BehaviorSubject, firstValueFrom, of } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCachedObservable } from "../utils/getCachedObservable";
import type { WalletId } from "../utils/WalletId";
import { ethereum } from "./ethereum/plugin";
import {
	createInjectedWallets$,
	type InjectedWalletsAdapter,
} from "./injectedWallets";
import { getKheopskit$ } from "./kheopskit";
import { polkadot } from "./polkadot/plugin";
import { createKheopskitStore } from "./store";
import type {
	BaseWallet,
	BaseWalletAccount,
	KheopskitPlatform,
	KheopskitState,
} from "./types";

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const BOB = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
const EXTENSION = "fake-extension";
const fakeWalletId = `polkadot:${EXTENSION}` as WalletId;
const ETH_ADDRESS = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const ETH_RDNS = "io.kheopskit.fake";
const ethWalletId = `ethereum:${ETH_RDNS}` as WalletId;
const engineWalletId = "polkadot:engine" as WalletId;

const settleMicrotasks = async () => {
	for (let i = 0; i < 30; i++) await Promise.resolve();
};

type Settlement = "pending" | "resolved" | "rejected";

const settlementOf = async (promise: Promise<unknown>): Promise<Settlement> => {
	let state: Settlement = "pending";
	promise.then(
		() => {
			state = "resolved";
		},
		() => {
			state = "rejected";
		},
	);
	await settleMicrotasks();
	return state;
};

const installFakeExtension = () => {
	const accounts = [
		{ address: ALICE, name: "Alice", type: "sr25519" },
		{ address: BOB, name: "Bob", type: "sr25519" },
	];
	const unsubscribe = vi.fn();
	let onAccountsChanged: ((next: typeof accounts) => void) | undefined;
	const injected = {
		accounts: {
			get: async () => accounts,
			subscribe: (listener: (next: typeof accounts) => void) => {
				onAccountsChanged = listener;
				return unsubscribe;
			},
		},
		signer: {
			signRaw: async () => ({ id: 1, signature: "0x" }),
			signPayload: async () => ({ id: 1, signature: "0x" }),
		},
	};
	const pendingEnables: Array<(value: typeof injected) => void> = [];
	const enable = vi.fn(
		() =>
			new Promise<typeof injected>((resolve) => {
				pendingEnables.push(resolve);
			}),
	);
	(window as unknown as { injectedWeb3: unknown }).injectedWeb3 = {
		[EXTENSION]: { version: "1.0.0", enable },
	};
	return {
		enable,
		unsubscribe,
		releaseEnable: () => {
			const resolve = pendingEnables.shift();
			if (!resolve) throw new Error("no pending enable() to release");
			resolve(injected);
		},
		changeAccounts: (next: typeof accounts) => {
			if (!onAccountsChanged) throw new Error("no accounts subscription");
			onAccountsChanged(next);
		},
		uninstall: () => {
			delete (window as unknown as { injectedWeb3?: unknown }).injectedWeb3;
		},
	};
};

const config = (hydrationGracePeriod: number, autoReconnect = false) => ({
	platforms: [polkadot({ accountTypes: ["sr25519" as const] })],
	autoReconnect,
	debug: false,
	storageKey: "kheopskit",
	hydrationGracePeriod,
});

const installFakeEthereumProvider = () => {
	const pendingAccounts: Array<(addresses: string[]) => void> = [];
	let holdAccounts = false;
	const provider = {
		request: async ({ method }: { method: string }) => {
			if (method === "eth_requestAccounts") return [ETH_ADDRESS];
			if (method === "eth_chainId") return "0x1";
			if (method === "eth_accounts")
				return holdAccounts
					? new Promise<string[]>((resolve) => pendingAccounts.push(resolve))
					: [ETH_ADDRESS];
			throw new Error(`unexpected request ${method}`);
		},
		on: () => {},
		removeListener: () => {},
	};
	const unannounce = announceProvider({
		info: {
			uuid: "00000000-0000-4000-8000-000000000001",
			name: "Fake Ethereum",
			icon: "data:image/svg+xml,",
			rdns: ETH_RDNS,
		},
		provider: provider as unknown as EIP6963ProviderDetail["provider"],
	});
	return {
		holdAccounts: () => {
			holdAccounts = true;
		},
		releaseAccounts: () => {
			const resolve = pendingAccounts.shift();
			if (!resolve) throw new Error("no pending eth_accounts to release");
			resolve([ETH_ADDRESS]);
		},
		uninstall: () => {
			unannounce();
			clearCachedObservable(`accounts:${ethWalletId}`);
		},
	};
};

const ethConfig = {
	platforms: [ethereum()],
	autoReconnect: false,
	debug: false,
	storageKey: "kheopskit",
	hydrationGracePeriod: 0,
};

type EngineSource = { name: string };

const enginePlatform = (
	overrides: Partial<InjectedWalletsAdapter<EngineSource, BaseWallet, string>>,
): KheopskitPlatform<"polkadot", BaseWallet, BaseWalletAccount> => ({
	platform: "polkadot",
	getWallets$: (ctx) =>
		createInjectedWallets$<EngineSource, BaseWallet, string>(ctx.store, {
			sources$: new BehaviorSubject<EngineSource[]>([{ name: "engine" }]),
			getWalletId: () => engineWalletId,
			connect: async () => "handle",
			buildWallet: ({ walletId, isConnected, connect, disconnect }) => ({
				id: walletId,
				platform: "polkadot",
				type: "injected",
				name: "Engine",
				icon: "",
				isConnected,
				connect,
				disconnect,
			}),
			...overrides,
		}),
	getAccounts$: () => of([]),
});

const engineConfig = (platform: KheopskitPlatform) => ({
	platforms: [platform],
	autoReconnect: false,
	debug: false,
	storageKey: "kheopskit",
	hydrationGracePeriod: 0,
});

const walletIn = (state: KheopskitState | undefined, walletId: WalletId) => {
	const found = state?.wallets.find((w) => w.id === walletId);
	if (!found) throw new Error(`${walletId} not in the latest emission`);
	return found;
};

const ethFramesFrom = (emissions: KheopskitState[], from: number) =>
	emissions.slice(from).map((state) => ({
		isConnected: walletIn(state, ethWalletId).isConnected,
		accounts: state.accounts
			.filter((a) => a.walletId === ethWalletId)
			.map((a) => a.address),
	}));

const rememberedWalletIds = (): string[] =>
	JSON.parse(localStorage.getItem("kheopskit") || "{}").remembered ?? [];

const cacheWallet = (
	store: ReturnType<typeof createKheopskitStore>,
	isConnected: boolean,
) =>
	store.setCachedState(
		[
			{
				id: fakeWalletId,
				platform: "polkadot",
				type: "injected",
				name: EXTENSION,
				isConnected,
			},
		],
		[],
	);

const collect = (
	state$: ReturnType<typeof getKheopskit$>,
	emissions: KheopskitState[],
) => {
	const sub = state$.subscribe((state) => emissions.push(state));
	const wallet = () => {
		const found = emissions.at(-1)?.wallets.find((w) => w.id === fakeWalletId);
		if (!found) throw new Error("fake wallet not in the latest emission");
		return found;
	};
	return { sub, wallet };
};

const accountsOf = (state: KheopskitState) =>
	state.accounts
		.filter((a) => a.walletId === fakeWalletId)
		.map((a) => a.address)
		.sort();

describe("getKheopskit$ connect semantics", () => {
	let fake: ReturnType<typeof installFakeExtension>;

	beforeEach(() => {
		localStorage.clear();
		vi.useFakeTimers({
			toFake: [
				"setTimeout",
				"clearTimeout",
				"setInterval",
				"clearInterval",
				"setImmediate",
				"clearImmediate",
				"Date",
			],
		});
		fake = installFakeExtension();
	});

	afterEach(() => {
		fake.uninstall();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("never emits a connected wallet with stale accounts", async () => {
		const emissions: KheopskitState[] = [];
		const { sub, wallet } = collect(
			getKheopskit$(config(0), { store: createKheopskitStore() }),
			emissions,
		);
		await settleMicrotasks();
		await vi.advanceTimersByTimeAsync(20);

		let connecting = wallet().connect();
		fake.releaseEnable();
		await connecting;
		await wallet().disconnect();
		connecting = wallet().connect();
		fake.releaseEnable();
		await connecting;

		const frames = emissions.map((state, index) => ({
			index,
			isConnected: state.wallets.find((w) => w.id === fakeWalletId)
				?.isConnected,
			accounts: accountsOf(state),
		}));
		expect(frames).toEqual(
			frames.map((frame) => ({
				...frame,
				accounts: frame.isConnected ? [ALICE, BOB].sort() : [],
			})),
		);
		expect(frames.filter((f) => f.isConnected).length).toBeGreaterThanOrEqual(
			2,
		);
		expect(frames.filter((f) => !f.isConnected).length).toBeGreaterThanOrEqual(
			2,
		);

		sub.unsubscribe();
	});

	it("connect resolves after the state shows the wallet connected", async () => {
		const emissions: KheopskitState[] = [];
		const { sub, wallet } = collect(
			getKheopskit$(config(0), { store: createKheopskitStore() }),
			emissions,
		);
		await settleMicrotasks();
		await vi.advanceTimersByTimeAsync(20);

		const connecting = wallet().connect();
		fake.releaseEnable();
		await connecting;

		expect(wallet().isConnected).toBe(true);
		expect(accountsOf(emissions.at(-1) as KheopskitState)).toEqual(
			[ALICE, BOB].sort(),
		);
		expect(vi.getTimerCount()).toBeGreaterThan(0);

		await wallet().disconnect();
		expect(wallet().isConnected).toBe(false);
		expect(accountsOf(emissions.at(-1) as KheopskitState)).toEqual([]);

		sub.unsubscribe();
	});

	it("connect during hydration resolves only once the emitted state shows the wallet connected", async () => {
		const store = createKheopskitStore();
		store.setCachedState(
			[
				{
					id: fakeWalletId,
					platform: "polkadot",
					type: "injected",
					name: EXTENSION,
					isConnected: false,
				},
			],
			[],
		);
		const emissions: KheopskitState[] = [];
		const { sub, wallet } = collect(
			getKheopskit$(config(500), { store }),
			emissions,
		);
		await settleMicrotasks();
		expect(emissions.at(-1)?.isHydrating).toBe(true);

		const connecting = wallet().connect();
		fake.releaseEnable();
		expect(await settlementOf(connecting)).toBe("pending");
		expect(wallet().isConnected).toBe(false);

		await vi.advanceTimersByTimeAsync(500);
		expect(await settlementOf(connecting)).toBe("resolved");
		expect(emissions.at(-1)?.isHydrating).toBe(false);
		expect(wallet().isConnected).toBe(true);

		sub.unsubscribe();
	});

	it("tearing down the last subscriber settles a pending connect", async () => {
		const emissions: KheopskitState[] = [];
		const { sub, wallet } = collect(
			getKheopskit$(config(0), { store: createKheopskitStore() }),
			emissions,
		);
		await settleMicrotasks();

		const pending = wallet().connect();
		sub.unsubscribe();

		expect(await settlementOf(pending)).toBe("rejected");
		await expect(pending).rejects.toMatchObject({
			name: "KheopskitError",
			code: "ABORTED",
			walletId: fakeWalletId,
		});

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const emitted = emissions.length;
		fake.releaseEnable();
		await settleMicrotasks();

		expect(emissions.length).toBe(emitted);
		expect(errorSpy).not.toHaveBeenCalled();
		expect(warnSpy).not.toHaveBeenCalled();
		expect(rememberedWalletIds()).toEqual([]);
		expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
	});

	it("a UI connect that aborts on unmount leaves a pending auto-reconnect to finish", async () => {
		const store = createKheopskitStore();
		store.rememberWallet(fakeWalletId);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const emissions: KheopskitState[] = [];
		const { sub, wallet } = collect(
			getKheopskit$(config(0, true), { store }),
			emissions,
		);
		await settleMicrotasks();
		expect(fake.enable).toHaveBeenCalledTimes(1);

		const unmount = new AbortController();
		const ui = wallet().connect({ signal: unmount.signal });
		unmount.abort();
		fake.releaseEnable();

		expect(await settlementOf(ui)).toBe("rejected");
		await expect(ui).rejects.toMatchObject({ code: "ABORTED" });
		expect(wallet().isConnected).toBe(true);
		expect(accountsOf(emissions.at(-1) as KheopskitState)).toEqual(
			[ALICE, BOB].sort(),
		);
		expect(rememberedWalletIds()).toEqual([fakeWalletId]);
		expect(fake.enable).toHaveBeenCalledTimes(1);
		expect(fake.unsubscribe).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();

		sub.unsubscribe();
	});

	it("an abort fired by the subscriber that sees the wallet connected leaves the connect resolved", async () => {
		const controller = new AbortController();
		const emissions: KheopskitState[] = [];
		const sub = getKheopskit$(config(0), {
			store: createKheopskitStore(),
		}).subscribe((state) => {
			emissions.push(state);
			if (state.wallets.some((w) => w.id === fakeWalletId && w.isConnected))
				controller.abort();
		});
		await settleMicrotasks();
		const wallet = emissions.at(-1)?.wallets.find((w) => w.id === fakeWalletId);
		if (!wallet) throw new Error("fake wallet not in the latest emission");

		const connecting = wallet.connect({ signal: controller.signal });
		await settleMicrotasks();
		fake.releaseEnable();

		expect(await settlementOf(connecting)).toBe("resolved");
		expect(controller.signal.aborted).toBe(true);
		expect(
			emissions.at(-1)?.wallets.find((w) => w.id === fakeWalletId)?.isConnected,
		).toBe(true);
		expect(rememberedWalletIds()).toEqual([fakeWalletId]);

		sub.unsubscribe();
	});

	it("connect on a wallet from a torn-down subscription rejects ABORTED without prompting", async () => {
		const state = await firstValueFrom(
			getKheopskit$(config(0), { store: createKheopskitStore() }),
		);
		const wallet = state.wallets.find((w) => w.id === fakeWalletId);
		if (!wallet) throw new Error("fake wallet not in the first emission");

		const connecting = wallet.connect();

		expect(await settlementOf(connecting)).toBe("rejected");
		await expect(connecting).rejects.toMatchObject({
			code: "ABORTED",
			walletId: fakeWalletId,
		});
		expect(fake.enable).not.toHaveBeenCalled();
		expect(rememberedWalletIds()).toEqual([]);
	});

	it("teardown between the platform's answer and the wrapper's resumption still settles the connect", async () => {
		const emissions: KheopskitState[] = [];
		const { sub, wallet } = collect(
			getKheopskit$(config(0), { store: createKheopskitStore() }),
			emissions,
		);
		await settleMicrotasks();

		const connecting = wallet().connect();
		fake.releaseEnable();
		while (!rememberedWalletIds().includes(fakeWalletId))
			await Promise.resolve();
		sub.unsubscribe();

		expect(await settlementOf(connecting)).toBe("rejected");
		await expect(connecting).rejects.toMatchObject({
			code: "ABORTED",
			walletId: fakeWalletId,
		});
	});

	it("disconnect while a connect waits for the state rejects that connect", async () => {
		const store = createKheopskitStore();
		cacheWallet(store, false);
		const emissions: KheopskitState[] = [];
		const { sub, wallet } = collect(
			getKheopskit$(config(500), { store }),
			emissions,
		);
		await settleMicrotasks();

		const connecting = wallet().connect();
		fake.releaseEnable();
		expect(await settlementOf(connecting)).toBe("pending");
		expect(rememberedWalletIds()).toEqual([fakeWalletId]);

		const disconnecting = wallet().disconnect();
		expect(await settlementOf(disconnecting)).toBe("resolved");
		expect(await settlementOf(connecting)).toBe("rejected");
		await expect(connecting).rejects.toMatchObject({
			code: "ABORTED",
			walletId: fakeWalletId,
		});
		expect(wallet().isConnected).toBe(false);
		expect(rememberedWalletIds()).toEqual([]);

		sub.unsubscribe();
	});

	it("connect resolves a disconnect that waits for the state", async () => {
		const store = createKheopskitStore();
		cacheWallet(store, true);
		const emissions: KheopskitState[] = [];
		const { sub, wallet } = collect(
			getKheopskit$(config(500), { store }),
			emissions,
		);
		await settleMicrotasks();

		const disconnecting = wallet().disconnect();
		expect(await settlementOf(disconnecting)).toBe("pending");

		const connecting = wallet().connect();
		fake.releaseEnable();
		expect(await settlementOf(connecting)).toBe("resolved");
		expect(await settlementOf(disconnecting)).toBe("resolved");
		expect(rememberedWalletIds()).toEqual([fakeWalletId]);

		sub.unsubscribe();
	});

	it("teardown resolves a disconnect that waits for the state", async () => {
		const store = createKheopskitStore();
		cacheWallet(store, true);
		const emissions: KheopskitState[] = [];
		const { sub, wallet } = collect(
			getKheopskit$(config(500), { store }),
			emissions,
		);
		await settleMicrotasks();

		const disconnecting = wallet().disconnect();
		expect(await settlementOf(disconnecting)).toBe("pending");

		sub.unsubscribe();
		expect(await settlementOf(disconnecting)).toBe("resolved");
	});

	it("disconnect during hydration resolves only once the emitted state shows the wallet disconnected", async () => {
		const store = createKheopskitStore();
		cacheWallet(store, true);
		const emissions: KheopskitState[] = [];
		const { sub, wallet } = collect(
			getKheopskit$(config(500), { store }),
			emissions,
		);
		await settleMicrotasks();
		expect(wallet().isConnected).toBe(true);

		const disconnecting = wallet().disconnect();
		expect(await settlementOf(disconnecting)).toBe("pending");
		expect(wallet().isConnected).toBe(true);

		await vi.advanceTimersByTimeAsync(3000);
		expect(await settlementOf(disconnecting)).toBe("resolved");
		expect(emissions.at(-1)?.isHydrating).toBe(false);
		expect(wallet().isConnected).toBe(false);

		sub.unsubscribe();
	});

	it("an accounts-only emission keeps the same wallet object and functions", async () => {
		const emissions: KheopskitState[] = [];
		const { sub, wallet } = collect(
			getKheopskit$(config(0), { store: createKheopskitStore() }),
			emissions,
		);
		await settleMicrotasks();

		const connecting = wallet().connect();
		fake.releaseEnable();
		await connecting;
		const connected = wallet();

		fake.changeAccounts([{ address: ALICE, name: "Alice", type: "sr25519" }]);
		await settleMicrotasks();

		expect(accountsOf(emissions.at(-2) as KheopskitState)).toEqual(
			[ALICE, BOB].sort(),
		);
		expect(accountsOf(emissions.at(-1) as KheopskitState)).toEqual([ALICE]);
		expect(wallet()).toBe(connected);
		expect(wallet().connect).toBe(connected.connect);
		expect(wallet().disconnect).toBe(connected.disconnect);

		sub.unsubscribe();
	});

	it("disconnect on a wallet from a torn-down subscription rejects ABORTED without asking the platform or touching the remembered list", async () => {
		const platformDisconnect = vi.fn(async () => {});
		const platform = enginePlatform({ disconnect: platformDisconnect });
		const store = createKheopskitStore();
		const first: KheopskitState[] = [];
		const firstSub = getKheopskit$(engineConfig(platform), { store }).subscribe(
			(state) => first.push(state),
		);
		await settleMicrotasks();
		await walletIn(first.at(-1), engineWalletId).connect();
		const stale = walletIn(first.at(-1), engineWalletId);
		expect(stale.isConnected).toBe(true);
		expect(rememberedWalletIds()).toEqual([engineWalletId]);
		firstSub.unsubscribe();

		const second: KheopskitState[] = [];
		const secondSub = getKheopskit$(engineConfig(platform), {
			store,
		}).subscribe((state) => second.push(state));
		await settleMicrotasks();
		await walletIn(second.at(-1), engineWalletId).connect();
		expect(walletIn(second.at(-1), engineWalletId).isConnected).toBe(true);
		const secondEmitted = second.length;

		const disconnecting = stale.disconnect();
		expect(await settlementOf(disconnecting)).toBe("rejected");
		await expect(disconnecting).rejects.toMatchObject({
			code: "ABORTED",
			walletId: engineWalletId,
		});
		expect(platformDisconnect).not.toHaveBeenCalled();
		expect(rememberedWalletIds()).toEqual([engineWalletId]);
		expect(walletIn(second.at(-1), engineWalletId).isConnected).toBe(true);
		expect(second.length).toBe(secondEmitted);

		secondSub.unsubscribe();
	});

	it("on Ethereum, connect resolves once the wallet shows connected and the accounts follow in a later emission with no stale accounts in between", async () => {
		const eth = installFakeEthereumProvider();
		const emissions: KheopskitState[] = [];
		const sub = getKheopskit$(ethConfig, {
			store: createKheopskitStore(),
		}).subscribe((state) => emissions.push(state));
		await settleMicrotasks();
		await vi.advanceTimersByTimeAsync(20);
		const wallet = () => walletIn(emissions.at(-1), ethWalletId);

		await wallet().connect();
		await settleMicrotasks();
		expect(ethFramesFrom(emissions, emissions.length - 1)).toEqual([
			{ isConnected: true, accounts: [ETH_ADDRESS] },
		]);

		const beforeDisconnect = emissions.length;
		await wallet().disconnect();
		expect(ethFramesFrom(emissions, beforeDisconnect)).toEqual([
			{ isConnected: false, accounts: [] },
		]);

		eth.holdAccounts();
		const beforeReconnect = emissions.length;
		await wallet().connect();
		expect(ethFramesFrom(emissions, beforeReconnect)).toEqual([
			{ isConnected: true, accounts: [] },
		]);

		eth.releaseAccounts();
		await settleMicrotasks();
		expect(ethFramesFrom(emissions, beforeReconnect)).toEqual([
			{ isConnected: true, accounts: [] },
			{ isConnected: true, accounts: [ETH_ADDRESS] },
		]);

		sub.unsubscribe();
		eth.uninstall();
	});
});
