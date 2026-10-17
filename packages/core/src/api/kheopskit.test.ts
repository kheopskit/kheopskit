import {
	BehaviorSubject,
	firstValueFrom,
	Subject,
	type Subscription,
	take,
} from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	cachedAccountOf,
	cachedWalletOf,
	createFakePolkadotExtension,
	createMemoryStorage,
	type FakePolkadotExtension,
} from "../testing";
import { getKheopskit$ } from "./kheopskit";
import { polkadot } from "./polkadot/plugin";
import { createKheopskitStore } from "./store";
import type {
	KheopskitConfig,
	KheopskitState,
	WalletConnectWallet,
} from "./types";

const { walletConnect } = vi.hoisted(() => ({
	walletConnect: {
		connector$: undefined as Subject<WalletConnectWallet | null> | undefined,
	},
}));

vi.mock("./appKit", async () => {
	const { of } = await import("rxjs");
	return {
		getWalletConnectWallet$: () => walletConnect.connector$ ?? of(null),
	};
});

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

const fakes: FakePolkadotExtension[] = [];

const install = (...args: Parameters<typeof createFakePolkadotExtension>) => {
	const fake = createFakePolkadotExtension(...args);
	fakes.push(fake);
	return fake;
};

const memoryStore = () =>
	createKheopskitStore({ storage: createMemoryStorage() });

afterEach(() => {
	for (const fake of fakes.splice(0)) fake.uninstall();
	walletConnect.connector$ = undefined;
});

const setReadyState = (value: DocumentReadyState) =>
	Object.defineProperty(document, "readyState", {
		value,
		configurable: true,
	});

const loadListeners: EventListener[] = [];

const captureLoadListeners = () => {
	const addEventListener = window.addEventListener.bind(window);
	vi.spyOn(window, "addEventListener").mockImplementation(
		(type, listener, options) => {
			if (type === "load") loadListeners.push(listener as EventListener);
			else addEventListener(type, listener, options);
		},
	);
};

const fireLoad = async () => {
	setReadyState("complete");
	for (const listener of [...loadListeners]) {
		listener(new Event("load"));
		await vi.advanceTimersByTimeAsync(0);
	}
};

describe("getKheopskit$ cached account filtering", () => {
	const seededStore = (polkadotAccountType: "ecdsa" | "ed25519") => {
		const store = memoryStore();
		const talisman = cachedWalletOf("polkadot:talisman", "Talisman");
		store.setCachedState(
			[talisman],
			[{ ...cachedAccountOf(talisman, ALICE), polkadotAccountType }],
		);
		return store;
	};

	const firstState = (
		store: ReturnType<typeof memoryStore>,
		accountTypes: ("sr25519" | "ed25519")[],
	) =>
		firstValueFrom(
			getKheopskit$(
				{
					platforms: [polkadot({ accountTypes })],
					autoReconnect: true,
					debug: false,
					storageKey: "kheopskit",
					hydrationGracePeriod: 500,
				},
				{ store },
			).pipe(take(1)),
		);

	it("filters cached polkadot accounts that are not allowed by the plugin", async () => {
		const state = await firstState(seededStore("ecdsa"), ["sr25519"]);

		expect(state.accounts).toEqual([]);
	});

	it("keeps cached polkadot accounts when the key type is allowed", async () => {
		const state = await firstState(seededStore("ed25519"), ["ed25519"]);

		expect(state.accounts).toHaveLength(1);
		const account = state.accounts[0];
		expect(account?.platform).toBe("polkadot");
		expect(account?.address).toBe(ALICE);
	});
});

describe("getKheopskit$ discovery", () => {
	let subscription: Subscription | undefined;

	const recordStates = () => {
		const states: KheopskitState[] = [];
		subscription = getKheopskit$(
			{ platforms: [polkadot()] },
			{ store: memoryStore() },
		).subscribe((state) => states.push(state));
		return states;
	};

	beforeEach(() => {
		vi.useFakeTimers();
		captureLoadListeners();
	});

	afterEach(() => {
		subscription?.unsubscribe();
		loadListeners.length = 0;
		vi.restoreAllMocks();
		Reflect.deleteProperty(document, "readyState");
		vi.useRealTimers();
	});

	it("isDiscovering is true before load and false after", async () => {
		setReadyState("interactive");
		const states = recordStates();

		await vi.advanceTimersByTimeAsync(1200);
		expect(states.length).toBeGreaterThan(0);
		expect(states.map((s) => s.isDiscovering)).not.toContain(false);

		await fireLoad();
		await vi.advanceTimersByTimeAsync(20);
		expect(states.at(-1)?.isDiscovering).toBe(false);
	});

	it("the emission that ends discovery already lists the extension present at load", async () => {
		setReadyState("interactive");
		const states = recordStates();

		await vi.advanceTimersByTimeAsync(1200);
		install({ name: "talisman" });
		await fireLoad();
		await vi.advanceTimersByTimeAsync(20);

		const settled = states.find((s) => s.isDiscovering === false);
		expect(settled?.wallets.map((w) => w.id)).toEqual(["polkadot:talisman"]);
	});

	it("isDiscovering is false from the first emission when subscribed after load", async () => {
		setReadyState("complete");
		const states = recordStates();

		await vi.advanceTimersByTimeAsync(20);
		expect(states[0]?.isDiscovering).toBe(false);
	});
});

describe("getKheopskit$ discovery while the WalletConnect connector loads", () => {
	let subscription: Subscription | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		walletConnect.connector$ = new Subject();
		captureLoadListeners();
	});

	afterEach(() => {
		subscription?.unsubscribe();
		loadListeners.length = 0;
		vi.restoreAllMocks();
		Reflect.deleteProperty(document, "readyState");
		vi.useRealTimers();
	});

	it("with a cached state, the emission that ends discovery already lists the extension present at load", async () => {
		setReadyState("interactive");
		const store = memoryStore();
		store.setCachedState(
			[{ ...cachedWalletOf("polkadot:cached", "Cached"), isConnected: false }],
			[],
		);
		const states: KheopskitState[] = [];
		subscription = getKheopskit$(
			{ platforms: [polkadot()] },
			{ store },
		).subscribe((state) => states.push(state));

		await vi.advanceTimersByTimeAsync(1200);
		install({ name: "talisman" });
		await fireLoad();
		await vi.advanceTimersByTimeAsync(20);
		walletConnect.connector$?.next(null);
		await vi.advanceTimersByTimeAsync(20);

		const settled = states.find((s) => s.isDiscovering === false);
		expect(settled?.wallets.map((w) => w.id)).toEqual(["polkadot:talisman"]);
	});
});

describe("getKheopskit$ account changes", () => {
	const config: KheopskitConfig = {
		platforms: [polkadot({ accountTypes: ["sr25519"] })],
		autoReconnect: true,
		debug: false,
		storageKey: "kheopskit",
		hydrationGracePeriod: 500,
	};

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("re-emits and re-persists when an account is renamed", async () => {
		const alice = { address: ALICE, name: "Alice", type: "sr25519" as const };
		const talisman = install({ name: "talisman", accounts: [alice] });
		const store = memoryStore();
		store.rememberWallet(talisman.walletId);
		const states: KheopskitState[] = [];
		const sub = getKheopskit$(config, { store }).subscribe((state) =>
			states.push(state),
		);
		await vi.advanceTimersByTimeAsync(2000);
		expect(store.getCachedState().accounts[0]?.name).toBe("Alice");
		const emissionsBeforeRename = states.length;

		talisman.setAccounts([{ ...alice, name: "Alice (renamed)" }]);
		await vi.advanceTimersByTimeAsync(100);

		expect(states).toHaveLength(emissionsBeforeRename + 1);
		expect(states.at(-1)?.accounts[0]?.name).toBe("Alice (renamed)");
		expect(store.getCachedState().accounts[0]?.name).toBe("Alice");

		await vi.advanceTimersByTimeAsync(1000);
		expect(store.getCachedState().accounts[0]?.name).toBe("Alice (renamed)");
		sub.unsubscribe();
		store.destroy();
	});
});

describe("getKheopskit$ reload with a cached connected wallet", () => {
	let subscription: Subscription | undefined;
	let talisman: FakePolkadotExtension;
	const walletId = "polkadot:talisman";
	const cachedWallet = cachedWalletOf(walletId, "Talisman");
	const cachedAccount = cachedAccountOf(cachedWallet, ALICE);

	beforeEach(() => {
		vi.useFakeTimers();
		setReadyState("complete");
		walletConnect.connector$ = new BehaviorSubject<WalletConnectWallet | null>(
			null,
		);
		talisman = install({ name: "talisman", enable: "hold" });
	});

	afterEach(() => {
		subscription?.unsubscribe();
		vi.restoreAllMocks();
		Reflect.deleteProperty(document, "readyState");
		vi.useRealTimers();
	});

	const statusesOf = (states: KheopskitState[]) =>
		states
			.map((s) => s.wallets.find((w) => w.id === walletId)?.status)
			.filter((status, i, all) => i === 0 || status !== all[i - 1]);

	it("isConnected is true only when status is connected", async () => {
		const store = memoryStore();
		store.rememberWallet(talisman.walletId);
		store.setCachedState([cachedWallet], [cachedAccount]);
		const states: KheopskitState[] = [];
		subscription = getKheopskit$(
			{ platforms: [polkadot()], hydrationGracePeriod: 500 },
			{ store },
		).subscribe((state) => states.push(state));

		await vi.advanceTimersByTimeAsync(100);
		const during = states.at(-1)?.wallets.find((w) => w.id === walletId);
		expect([during?.status, during?.isConnected]).toEqual([
			"connecting",
			false,
		]);
		expect(states.at(-1)?.accounts.map((a) => a.id)).toEqual([
			cachedAccount.id,
		]);

		talisman.resolveEnable();
		await vi.advanceTimersByTimeAsync(300);
		const after = states.at(-1)?.wallets.find((w) => w.id === walletId);
		expect([after?.status, after?.isConnected]).toEqual(["connected", true]);

		expect(statusesOf(states)).toEqual(["connecting", "connected"]);
		for (const state of states)
			for (const wallet of state.wallets)
				expect(wallet.isConnected).toBe(wallet.status === "connected");
		store.destroy();
	});
});
