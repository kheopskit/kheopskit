import { firstValueFrom } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletId } from "../utils/WalletId";
import { getKheopskit$ } from "./kheopskit";
import { polkadot } from "./polkadot/plugin";
import { createKheopskitStore } from "./store";
import type { KheopskitState } from "./types";

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const BOB = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
const EXTENSION = "fake-extension";
const fakeWalletId = `polkadot:${EXTENSION}` as WalletId;

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

const rememberedWalletIds = (): string[] =>
	JSON.parse(localStorage.getItem("kheopskit") || "{}").autoReconnect ?? [];

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
		store.addEnabledWalletId(fakeWalletId);
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
});
