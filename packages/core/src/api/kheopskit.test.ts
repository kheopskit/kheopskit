import { firstValueFrom, take } from "rxjs";
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

/**
 * Installs a `window.injectedWeb3` extension whose `enable()` stays pending
 * until the test releases it, so a connect can be observed in flight.
 */
const installFakeExtension = () => {
	const accounts = [
		{ address: ALICE, name: "Alice", type: "sr25519" },
		{ address: BOB, name: "Bob", type: "sr25519" },
	];
	const unsubscribe = vi.fn();
	const injected = {
		accounts: {
			get: async () => accounts,
			subscribe: () => unsubscribe,
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
		uninstall: () => {
			delete (window as unknown as { injectedWeb3?: unknown }).injectedWeb3;
		},
	};
};

const config = (hydrationGracePeriod: number) => ({
	platforms: [polkadot({ accountTypes: ["sr25519" as const] })],
	autoReconnect: false,
	debug: false,
	storageKey: "kheopskit",
	hydrationGracePeriod,
});

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
		vi.useFakeTimers();
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
		const startedAt = process.hrtime.bigint();
		await connecting;
		const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
		console.info(`connect-to-resolve latency: ${latencyMs.toFixed(3)} ms`);

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
		expect(
			JSON.parse(localStorage.getItem("kheopskit") || "{}").autoReconnect ?? [],
		).toEqual([]);
		expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
	});
});

describe("getKheopskit$ cached account filtering", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("filters cached polkadot accounts that are not allowed by the plugin", async () => {
		const store = createKheopskitStore();
		const walletId = "polkadot:talisman" as WalletId;

		store.setCachedState(
			[
				{
					id: walletId,
					platform: "polkadot",
					type: "injected",
					name: "Talisman",
					isConnected: true,
				},
			],
			[
				{
					id: `${walletId}::5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY`,
					platform: "polkadot",
					address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
					walletId,
					walletName: "Talisman",
					polkadotAccountType: "ecdsa",
				},
			],
		);

		const state = await firstValueFrom(
			getKheopskit$(
				{
					platforms: [polkadot({ accountTypes: ["sr25519"] })],
					autoReconnect: true,
					debug: false,
					storageKey: "kheopskit",
					hydrationGracePeriod: 500,
				},
				{ store },
			).pipe(take(1)),
		);

		expect(state.accounts).toEqual([]);
	});

	it("keeps cached polkadot accounts when the key type is allowed", async () => {
		const store = createKheopskitStore();
		const walletId = "polkadot:talisman" as WalletId;

		store.setCachedState(
			[
				{
					id: walletId,
					platform: "polkadot",
					type: "injected",
					name: "Talisman",
					isConnected: true,
				},
			],
			[
				{
					id: `${walletId}::5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY`,
					platform: "polkadot",
					address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
					walletId,
					walletName: "Talisman",
					polkadotAccountType: "ed25519",
				},
			],
		);

		const state = await firstValueFrom(
			getKheopskit$(
				{
					platforms: [polkadot({ accountTypes: ["ed25519"] })],
					autoReconnect: true,
					debug: false,
					storageKey: "kheopskit",
					hydrationGracePeriod: 500,
				},
				{ store },
			).pipe(take(1)),
		);

		expect(state.accounts).toHaveLength(1);
		const account = state.accounts[0];
		expect(account?.platform).toBe("polkadot");
		expect(account?.address).toBe(
			"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
		);
	});
});
