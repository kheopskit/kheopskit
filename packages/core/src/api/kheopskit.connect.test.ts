import { getWallets } from "@wallet-standard/app";
import type { Wallet as WalletStandardWallet } from "@wallet-standard/base";
import { announceProvider, type EIP6963ProviderDetail } from "mipd";
import { BehaviorSubject, firstValueFrom, of } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearCachedObservable,
	clearCachedObservablesByPrefix,
} from "../utils/getCachedObservable";
import type { WalletId } from "../utils/WalletId";
import { ethereum } from "./ethereum/plugin";
import {
	createInjectedWallets$,
	type InjectedWalletsAdapter,
} from "./injectedWallets";
import { getKheopskit$ } from "./kheopskit";
import { polkadot } from "./polkadot/plugin";
import { solana } from "./solana/plugin";
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

const installedEthereumProviders: Array<{ uninstall: () => void }> = [];

const installFakeEthereumProvider = ({
	rdns = ETH_RDNS,
	uuid = "00000000-0000-4000-8000-000000000001",
	address = ETH_ADDRESS,
} = {}) => {
	const walletId = `ethereum:${rdns}` as WalletId;
	const pendingAccounts: Array<(addresses: string[]) => void> = [];
	let holdAccounts = false;
	const provider = {
		request: async ({ method }: { method: string }) => {
			if (method === "eth_requestAccounts") return [address];
			if (method === "eth_chainId") return "0x1";
			if (method === "eth_accounts")
				return holdAccounts
					? new Promise<string[]>((resolve) => pendingAccounts.push(resolve))
					: [address];
			throw new Error(`unexpected request ${method}`);
		},
		on: () => {},
		removeListener: () => {},
	};
	const unannounce = announceProvider({
		info: { uuid, name: `Fake ${rdns}`, icon: "data:image/svg+xml,", rdns },
		provider: provider as unknown as EIP6963ProviderDetail["provider"],
	});
	const installed = {
		walletId,
		address,
		holdAccounts: () => {
			holdAccounts = true;
		},
		pendingAccountRequests: () => pendingAccounts.length,
		releaseAccounts: (addresses = [address]) => {
			const resolve = pendingAccounts.shift();
			if (!resolve) throw new Error("no pending eth_accounts to release");
			resolve(addresses);
		},
		uninstall: () => {
			unannounce();
			clearCachedObservable(`accounts:${walletId}`);
		},
	};
	installedEthereumProviders.push(installed);
	return installed;
};

const ethConfig = {
	platforms: [ethereum()],
	autoReconnect: false,
	debug: false,
	storageKey: "kheopskit",
	hydrationGracePeriod: 0,
};

const solanaConfig = {
	platforms: [solana()],
	autoReconnect: false,
	debug: false,
	storageKey: "kheopskit",
	hydrationGracePeriod: 0,
};

const registeredStandardWallets: Array<() => void> = [];

const registerFakeStandardWallet = ({
	name = "Fake Standard",
	disconnect,
}: {
	name?: string;
	disconnect?: () => Promise<void>;
} = {}) => {
	const pendingConnects: Array<() => void> = [];
	const wallet = {
		version: "1.0.0",
		name,
		icon: "data:image/svg+xml;base64,AAAA",
		chains: ["solana:mainnet"],
		accounts: [],
		features: {
			"standard:connect": {
				version: "1.0.0",
				connect: () =>
					new Promise<{ accounts: [] }>((resolve) => {
						pendingConnects.push(() => resolve({ accounts: [] }));
					}),
			},
			...(disconnect && {
				"standard:disconnect": { version: "1.0.0", disconnect },
			}),
		},
	};
	const unregister = getWallets().register(
		wallet as unknown as WalletStandardWallet,
	);
	registeredStandardWallets.push(unregister);
	return {
		walletId: `solana:${name}` as WalletId,
		unregister,
		pendingConnects: () => pendingConnects.length,
		grantConnect: () => {
			const grant = pendingConnects.shift();
			if (!grant) throw new Error("no pending standard:connect to grant");
			grant();
		},
	};
};

const createDeferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
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
			buildWallet: ({
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
				name: "Engine",
				icon: "",
				status,
				error,
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

const ethFramesFrom = (
	emissions: KheopskitState[],
	from: number,
	walletId = ethWalletId,
) =>
	emissions.slice(from).map((state) => ({
		status: walletIn(state, walletId).status,
		isConnected: walletIn(state, walletId).isConnected,
		accounts: state.accounts
			.filter((a) => a.walletId === walletId)
			.map((a) => a.address),
	}));

const rememberedWalletIds = (): string[] =>
	JSON.parse(localStorage.getItem("kheopskit") || "{}").remembered ?? [];

const cacheWallet = (
	store: ReturnType<typeof createKheopskitStore>,
	isConnected: boolean,
	{ id = fakeWalletId, name = EXTENSION } = {},
) =>
	store.setCachedState(
		[{ id, platform: "polkadot", type: "injected", name, isConnected }],
		[],
	);

const subscribeEngineDuringHydration = (
	sources$: BehaviorSubject<EngineSource[]>,
	cachedIsConnected: boolean,
	overrides: Partial<
		InjectedWalletsAdapter<EngineSource, BaseWallet, string>
	> = {},
) => {
	const platform = enginePlatform({ sources$, ...overrides });
	const store = createKheopskitStore();
	cacheWallet(store, cachedIsConnected, { id: engineWalletId, name: "Engine" });
	const emissions: KheopskitState[] = [];
	const sub = getKheopskit$(
		{ ...engineConfig(platform), hydrationGracePeriod: 500 },
		{ store },
	).subscribe((state) => emissions.push(state));
	return { emissions, sub };
};

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
		for (const eth of installedEthereumProviders.splice(0)) eth.uninstall();
		for (const unregister of registeredStandardWallets.splice(0)) unregister();
		clearCachedObservablesByPrefix("accounts:solana:");
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

		const settlements: Settlement[] = [];
		let connecting = wallet().connect();
		fake.releaseEnable();
		settlements.push(await settlementOf(connecting));
		settlements.push(await settlementOf(wallet().disconnect()));
		connecting = wallet().connect();
		fake.releaseEnable();
		settlements.push(await settlementOf(connecting));

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
		expect(settlements).toEqual(["resolved", "resolved", "resolved"]);

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

	it("connect during hydration resolves once the emitted state shows the wallet connected, before hydration ends", async () => {
		const store = createKheopskitStore();
		cacheWallet(store, false);
		const emissions: KheopskitState[] = [];
		const { sub, wallet } = collect(
			getKheopskit$(config(500), { store }),
			emissions,
		);
		await settleMicrotasks();
		expect(emissions.at(-1)?.isHydrating).toBe(true);
		expect([wallet().status, wallet().isConnected]).toEqual([
			"disconnected",
			false,
		]);

		const connecting = wallet().connect();
		await settleMicrotasks();
		expect([wallet().status, wallet().isConnected]).toEqual([
			"connecting",
			false,
		]);
		fake.releaseEnable();
		expect(await settlementOf(connecting)).toBe("resolved");
		expect([wallet().status, wallet().isConnected]).toEqual([
			"connected",
			true,
		]);
		expect(emissions.at(-1)?.isHydrating).toBe(true);

		await vi.advanceTimersByTimeAsync(500);
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

	it("a cached connected wallet shows connecting from the first frame and connected once its reconnect is granted", async () => {
		const store = createKheopskitStore();
		store.rememberWallet(fakeWalletId);
		cacheWallet(store, true);
		const emissions: KheopskitState[] = [];
		const { sub, wallet } = collect(
			getKheopskit$(config(500, true), { store }),
			emissions,
		);
		await settleMicrotasks();
		expect(fake.enable).toHaveBeenCalledTimes(1);
		expect(
			emissions.map((state) => [
				walletIn(state, fakeWalletId).status,
				walletIn(state, fakeWalletId).isConnected,
			]),
		).toEqual([["connecting", false]]);

		fake.releaseEnable();
		await settleMicrotasks();
		expect([wallet().status, wallet().isConnected]).toEqual([
			"connected",
			true,
		]);
		expect(emissions.at(-1)?.isHydrating).toBe(true);

		await vi.advanceTimersByTimeAsync(500);
		expect(emissions.at(-1)?.isHydrating).toBe(false);
		expect(wallet().isConnected).toBe(true);

		sub.unsubscribe();
	});

	it("connect during a pending reconnect shares the attempt and resolves with it", async () => {
		const store = createKheopskitStore();
		store.rememberWallet(fakeWalletId);
		cacheWallet(store, true);
		const emissions: KheopskitState[] = [];
		const { sub, wallet } = collect(
			getKheopskit$(config(500, true), { store }),
			emissions,
		);
		await settleMicrotasks();
		expect(wallet().status).toBe("connecting");

		const connecting = wallet().connect();
		expect(await settlementOf(connecting)).toBe("pending");
		expect(fake.enable).toHaveBeenCalledTimes(1);

		fake.releaseEnable();
		expect(await settlementOf(connecting)).toBe("resolved");
		expect([wallet().status, wallet().isConnected]).toEqual([
			"connected",
			true,
		]);
		expect(rememberedWalletIds()).toEqual([fakeWalletId]);

		sub.unsubscribe();
	});

	it("disconnect during a pending reconnect aborts it and shows the wallet disconnected while hydration goes on", async () => {
		const store = createKheopskitStore();
		store.rememberWallet(fakeWalletId);
		cacheWallet(store, true);
		const emissions: KheopskitState[] = [];
		const { sub, wallet } = collect(
			getKheopskit$(config(500, true), { store }),
			emissions,
		);
		await settleMicrotasks();
		expect(wallet().status).toBe("connecting");

		const disconnecting = wallet().disconnect();
		expect(await settlementOf(disconnecting)).toBe("resolved");
		expect([wallet().status, wallet().isConnected, wallet().error]).toEqual([
			"disconnected",
			false,
			undefined,
		]);
		expect(emissions.at(-1)?.isHydrating).toBe(true);

		fake.releaseEnable();
		await settleMicrotasks();
		expect(wallet().status).toBe("disconnected");

		sub.unsubscribe();
	});

	it("a user disconnect after the reconnect was granted shows the wallet disconnected while hydration goes on", async () => {
		const store = createKheopskitStore();
		store.rememberWallet(fakeWalletId);
		cacheWallet(store, true);
		const emissions: KheopskitState[] = [];
		const { sub, wallet } = collect(
			getKheopskit$(config(500, true), { store }),
			emissions,
		);
		await settleMicrotasks();
		fake.releaseEnable();
		await settleMicrotasks();
		expect(wallet().status).toBe("connected");

		await wallet().disconnect();
		expect([wallet().status, wallet().isConnected]).toEqual([
			"disconnected",
			false,
		]);
		expect(emissions.at(-1)?.isHydrating).toBe(true);
		expect(rememberedWalletIds()).toEqual([]);

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
			message: `[kheopskit] disconnect of wallet ${engineWalletId} was aborted`,
		});
		expect(platformDisconnect).not.toHaveBeenCalled();
		expect(rememberedWalletIds()).toEqual([engineWalletId]);
		expect(walletIn(second.at(-1), engineWalletId).isConnected).toBe(true);
		expect(second.length).toBe(secondEmitted);

		secondSub.unsubscribe();
	});

	it("a Wallet Standard wallet that unregisters while its connect is pending rejects that connect ABORTED, and a later grant neither connects nor remembers it", async () => {
		const standard = registerFakeStandardWallet();
		const emissions: KheopskitState[] = [];
		const sub = getKheopskit$(solanaConfig, {
			store: createKheopskitStore(),
		}).subscribe((state) => emissions.push(state));
		await settleMicrotasks();

		const connecting = walletIn(emissions.at(-1), standard.walletId).connect();
		await settleMicrotasks();
		expect(standard.pendingConnects()).toBe(1);

		standard.unregister();
		expect(await settlementOf(connecting)).toBe("rejected");
		await expect(connecting).rejects.toMatchObject({
			code: "ABORTED",
			walletId: standard.walletId,
			message: `[kheopskit] connect of wallet ${standard.walletId} was aborted`,
		});
		expect(emissions.at(-1)?.wallets).toEqual([]);

		const emitted = emissions.length;
		standard.grantConnect();
		await settleMicrotasks();
		expect(rememberedWalletIds()).toEqual([]);
		expect(emissions.length).toBe(emitted);
		expect(
			emissions.some((state) =>
				state.wallets.some((w) => w.id === standard.walletId && w.isConnected),
			),
		).toBe(false);

		sub.unsubscribe();
	});

	it("a wallet that leaves the list while its connect is pending during hydration rejects that connect ABORTED and is gone once hydration ends", async () => {
		const sources$ = new BehaviorSubject<EngineSource[]>([{ name: "engine" }]);
		const grant = createDeferred<string>();
		const { emissions, sub } = subscribeEngineDuringHydration(sources$, false, {
			connect: () => grant.promise,
		});
		await settleMicrotasks();
		expect(emissions.at(-1)?.isHydrating).toBe(true);

		const connecting = walletIn(emissions.at(-1), engineWalletId).connect();
		expect(await settlementOf(connecting)).toBe("pending");
		expect(walletIn(emissions.at(-1), engineWalletId).status).toBe(
			"connecting",
		);

		sources$.next([]);
		expect(await settlementOf(connecting)).toBe("rejected");
		await expect(connecting).rejects.toMatchObject({
			code: "ABORTED",
			walletId: engineWalletId,
			message: `[kheopskit] connect of wallet ${engineWalletId} was aborted`,
		});

		await vi.advanceTimersByTimeAsync(500);
		expect(emissions.at(-1)?.isHydrating).toBe(false);
		expect(emissions.at(-1)?.wallets).toEqual([]);

		grant.resolve("handle");
		await settleMicrotasks();
		expect(rememberedWalletIds()).toEqual([]);

		sub.unsubscribe();
	});

	it("a wallet that leaves the list after the platform granted its connect during hydration keeps that connect resolved and stays remembered", async () => {
		const sources$ = new BehaviorSubject<EngineSource[]>([{ name: "engine" }]);
		const grant = createDeferred<string>();
		const { emissions, sub } = subscribeEngineDuringHydration(sources$, false, {
			connect: () => grant.promise,
		});
		await settleMicrotasks();
		expect(emissions.at(-1)?.isHydrating).toBe(true);

		const connecting = walletIn(emissions.at(-1), engineWalletId).connect();
		const stateAtResolution = connecting.then(
			() => emissions.at(-1),
			() => undefined,
		);
		expect(await settlementOf(connecting)).toBe("pending");

		grant.resolve("handle");
		expect(await settlementOf(connecting)).toBe("resolved");
		const wallet = walletIn(await stateAtResolution, engineWalletId);
		expect([wallet.status, wallet.isConnected]).toEqual(["connected", true]);
		expect(rememberedWalletIds()).toEqual([engineWalletId]);

		sources$.next([]);
		await vi.advanceTimersByTimeAsync(500);
		expect(emissions.at(-1)?.isHydrating).toBe(false);
		expect(emissions.at(-1)?.wallets).toEqual([]);
		expect(rememberedWalletIds()).toEqual([engineWalletId]);

		sub.unsubscribe();
	});

	it("a wallet that leaves the list the moment the engine remembers its granted connect resolves that connect, stays remembered and shows connected once re-added", async () => {
		const sources$ = new BehaviorSubject<EngineSource[]>([{ name: "engine" }]);
		const grant = createDeferred<string>();
		const platform = enginePlatform({ sources$, connect: () => grant.promise });
		const store = createKheopskitStore();
		const emissions: KheopskitState[] = [];
		const sub = getKheopskit$(engineConfig(platform), { store }).subscribe(
			(state) => emissions.push(state),
		);
		await settleMicrotasks();
		const removeOnRemember = store.observable.subscribe((state) => {
			if ((state.remembered ?? []).length > 0) sources$.next([]);
		});

		const connecting = walletIn(emissions.at(-1), engineWalletId).connect();
		grant.resolve("handle");
		expect(await settlementOf(connecting)).toBe("resolved");
		expect(emissions.at(-1)?.wallets).toEqual([]);
		expect(rememberedWalletIds()).toEqual([engineWalletId]);

		removeOnRemember.unsubscribe();
		sources$.next([{ name: "engine" }]);
		await settleMicrotasks();
		expect(walletIn(emissions.at(-1), engineWalletId).isConnected).toBe(true);

		sub.unsubscribe();
	});

	it("a disconnect whose platform call fails while a granted connect waits for the state leaves that connect to resolve, with the wallet remembered and connected", async () => {
		const standard = registerFakeStandardWallet({
			disconnect: () => Promise.reject(new Error("refused")),
		});
		const store = createKheopskitStore();
		store.setCachedState(
			[
				{
					id: standard.walletId,
					platform: "solana",
					type: "injected",
					name: "Fake Standard",
					isConnected: false,
				},
			],
			[],
		);
		const emissions: KheopskitState[] = [];
		const sub = getKheopskit$(
			{ ...solanaConfig, hydrationGracePeriod: 500 },
			{ store },
		).subscribe((state) => emissions.push(state));
		await settleMicrotasks();
		expect(emissions.at(-1)?.isHydrating).toBe(true);

		const connecting = walletIn(emissions.at(-1), standard.walletId).connect();
		await settleMicrotasks();
		standard.grantConnect();
		expect(await settlementOf(connecting)).toBe("resolved");
		expect(walletIn(emissions.at(-1), standard.walletId).isConnected).toBe(
			true,
		);
		expect(emissions.at(-1)?.isHydrating).toBe(true);

		const disconnecting = walletIn(
			emissions.at(-1),
			standard.walletId,
		).disconnect();
		expect(await settlementOf(disconnecting)).toBe("rejected");
		await expect(disconnecting).rejects.toThrow("refused");

		await vi.advanceTimersByTimeAsync(500);
		expect({
			connect: await settlementOf(connecting),
			remembered: rememberedWalletIds(),
			isConnected: walletIn(emissions.at(-1), standard.walletId).isConnected,
		}).toEqual({
			connect: "resolved",
			remembered: [standard.walletId],
			isConnected: true,
		});

		sub.unsubscribe();
	});

	it("a disconnect whose wallet leaves the list the moment the store forgets it resolves", async () => {
		const sources$ = new BehaviorSubject<EngineSource[]>([{ name: "engine" }]);
		const platform = enginePlatform({ sources$ });
		const store = createKheopskitStore();
		const emissions: KheopskitState[] = [];
		const sub = getKheopskit$(engineConfig(platform), { store }).subscribe(
			(state) => emissions.push(state),
		);
		await settleMicrotasks();
		await walletIn(emissions.at(-1), engineWalletId).connect();
		expect(walletIn(emissions.at(-1), engineWalletId).isConnected).toBe(true);
		const removeOnForget = store.observable.subscribe((state) => {
			if ((state.remembered ?? []).length === 0) sources$.next([]);
		});

		const disconnecting = walletIn(
			emissions.at(-1),
			engineWalletId,
		).disconnect();
		expect(await settlementOf(disconnecting)).toBe("resolved");
		expect(emissions.at(-1)?.wallets).toEqual([]);
		expect(rememberedWalletIds()).toEqual([]);

		removeOnForget.unsubscribe();
		sub.unsubscribe();
	});

	it("a disconnect on a cached connected wallet the reconnect rule rejects resolves at once, and the wallet leaves the list with its source", async () => {
		const sources$ = new BehaviorSubject<EngineSource[]>([{ name: "engine" }]);
		const { emissions, sub } = subscribeEngineDuringHydration(sources$, true);
		await settleMicrotasks();
		expect([
			walletIn(emissions.at(-1), engineWalletId).status,
			walletIn(emissions.at(-1), engineWalletId).isConnected,
		]).toEqual(["disconnected", false]);

		const disconnecting = walletIn(
			emissions.at(-1),
			engineWalletId,
		).disconnect();
		expect(await settlementOf(disconnecting)).toBe("resolved");

		sources$.next([]);
		await vi.advanceTimersByTimeAsync(3000);
		expect(emissions.at(-1)?.wallets).toEqual([]);

		sub.unsubscribe();
	});

	it("a platform stream that errors while a connect is pending rejects that connect ABORTED and ends the subscription", async () => {
		const sources$ = new BehaviorSubject<EngineSource[]>([{ name: "engine" }]);
		const grant = createDeferred<string>();
		const platform = enginePlatform({ sources$, connect: () => grant.promise });
		const emissions: KheopskitState[] = [];
		const errors: unknown[] = [];
		const sub = getKheopskit$(engineConfig(platform), {
			store: createKheopskitStore(),
		}).subscribe({
			next: (state) => emissions.push(state),
			error: (error) => errors.push(error),
		});
		await settleMicrotasks();

		const connecting = walletIn(emissions.at(-1), engineWalletId).connect();
		expect(await settlementOf(connecting)).toBe("pending");

		sources$.error(new Error("registry gone"));
		expect(await settlementOf(connecting)).toBe("rejected");
		await expect(connecting).rejects.toMatchObject({
			code: "ABORTED",
			walletId: engineWalletId,
		});
		expect(errors.map((error) => (error as Error).message)).toEqual([
			"registry gone",
		]);
		expect(sub.closed).toBe(true);

		grant.resolve("handle");
		await settleMicrotasks();
		expect(rememberedWalletIds()).toEqual([]);
	});

	it("a platform stream that completes while a connect is pending leaves the connect to settle with the platform's answer", async () => {
		const sources$ = new BehaviorSubject<EngineSource[]>([{ name: "engine" }]);
		const grant = createDeferred<string>();
		const platform = enginePlatform({ sources$, connect: () => grant.promise });
		const emissions: KheopskitState[] = [];
		const sub = getKheopskit$(engineConfig(platform), {
			store: createKheopskitStore(),
		}).subscribe((state) => emissions.push(state));
		await settleMicrotasks();

		const connecting = walletIn(emissions.at(-1), engineWalletId).connect();
		sources$.complete();
		expect(await settlementOf(connecting)).toBe("pending");

		grant.resolve("handle");
		expect(await settlementOf(connecting)).toBe("resolved");
		expect(walletIn(emissions.at(-1), engineWalletId).isConnected).toBe(true);
		expect(rememberedWalletIds()).toEqual([engineWalletId]);
		expect(sub.closed).toBe(false);

		sub.unsubscribe();
	});

	it("on Ethereum, connect resolves once the wallet shows connected, the accounts follow in a later emission, and a previous connection's late eth_accounts answer never shows", async () => {
		const OLD = "0x2222222222222222222222222222222222222222";
		const NEW = "0x3333333333333333333333333333333333333333";
		const eth = installFakeEthereumProvider({ address: NEW });
		eth.holdAccounts();
		const emissions: KheopskitState[] = [];
		const sub = getKheopskit$(ethConfig, {
			store: createKheopskitStore(),
		}).subscribe((state) => emissions.push(state));
		await settleMicrotasks();
		await vi.advanceTimersByTimeAsync(20);
		const wallet = () => walletIn(emissions.at(-1), ethWalletId);
		const start = emissions.length;

		await wallet().connect();
		await wallet().disconnect();
		await wallet().connect();
		expect(eth.pendingAccountRequests()).toBe(2);
		expect(ethFramesFrom(emissions, start)).toEqual([
			{ status: "connecting", isConnected: false, accounts: [] },
			{ status: "connected", isConnected: true, accounts: [] },
			{ status: "disconnected", isConnected: false, accounts: [] },
			{ status: "connecting", isConnected: false, accounts: [] },
			{ status: "connected", isConnected: true, accounts: [] },
		]);

		eth.releaseAccounts([OLD]);
		await settleMicrotasks();
		eth.releaseAccounts([NEW]);
		await settleMicrotasks();
		expect(ethFramesFrom(emissions, start)).toEqual([
			{ status: "connecting", isConnected: false, accounts: [] },
			{ status: "connected", isConnected: true, accounts: [] },
			{ status: "disconnected", isConnected: false, accounts: [] },
			{ status: "connecting", isConnected: false, accounts: [] },
			{ status: "connected", isConnected: true, accounts: [] },
			{ status: "connected", isConnected: true, accounts: [NEW] },
		]);

		sub.unsubscribe();
	});

	it("an emission never lists the accounts of a wallet it shows disconnected, even while another wallet's accounts are being re-read", async () => {
		const a = installFakeEthereumProvider({
			rdns: "io.kheopskit.a",
			uuid: "00000000-0000-4000-8000-00000000000a",
			address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		});
		const b = installFakeEthereumProvider({
			rdns: "io.kheopskit.b",
			uuid: "00000000-0000-4000-8000-00000000000b",
			address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		});
		const emissions: KheopskitState[] = [];
		const sub = getKheopskit$(ethConfig, {
			store: createKheopskitStore(),
		}).subscribe((state) => emissions.push(state));
		await settleMicrotasks();
		await vi.advanceTimersByTimeAsync(20);
		const addresses = (state: KheopskitState | undefined) =>
			state?.accounts.map((account) => account.address.toLowerCase()).sort();

		await walletIn(emissions.at(-1), a.walletId).connect();
		await walletIn(emissions.at(-1), b.walletId).connect();
		await settleMicrotasks();
		expect(addresses(emissions.at(-1))).toEqual([a.address, b.address]);

		a.holdAccounts();
		const beforeDisconnect = emissions.length;
		await walletIn(emissions.at(-1), b.walletId).disconnect();
		expect(a.pendingAccountRequests()).toBe(1);
		expect(ethFramesFrom(emissions, beforeDisconnect, b.walletId)).toEqual([
			{ status: "disconnected", isConnected: false, accounts: [] },
		]);
		expect(addresses(emissions.at(-1))).toEqual([a.address]);

		a.releaseAccounts();
		await settleMicrotasks();
		expect(ethFramesFrom(emissions, beforeDisconnect, b.walletId)).toEqual([
			{ status: "disconnected", isConnected: false, accounts: [] },
		]);
		expect(addresses(emissions.at(-1))).toEqual([a.address]);

		sub.unsubscribe();
	});
});
