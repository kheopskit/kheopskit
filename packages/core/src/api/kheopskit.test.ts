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
import { WALLET_CONNECT_WALLET_ID, type WalletId } from "../utils/WalletId";
import { getKheopskit$ } from "./kheopskit";
import { polkadot } from "./polkadot/plugin";
import { createKheopskitStore } from "./store";
import {
	type AppKitInstance,
	type CachedAccount,
	isWalletConnectWallet,
	type KheopskitConfig,
	type KheopskitState,
	type WalletConnectPlugin,
	type WalletConnectWallet,
} from "./types";

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
	let connector$: Subject<WalletConnectWallet | null>;
	const walletConnectPlugin: WalletConnectPlugin = {
		type: "walletconnect",
		metadata: { name: "Test Dapp", description: "", url: "", icons: [] },
		getWallet$: () => connector$,
	};

	beforeEach(() => {
		vi.useFakeTimers();
		connector$ = new Subject();
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
			{ platforms: [polkadot()], walletConnect: walletConnectPlugin },
			{ store },
		).subscribe((state) => states.push(state));

		await vi.advanceTimersByTimeAsync(1200);
		install({ name: "talisman" });
		await fireLoad();
		await vi.advanceTimersByTimeAsync(20);
		connector$.next(null);
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
		hydrationTimeout: 3000,
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

describe("getKheopskit$ placeholders", () => {
	let subscription: Subscription | undefined;
	const walletId = "polkadot:talisman";
	const addresses = [ALICE, "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"];
	const accounts = addresses.map((address) => ({
		address,
		type: "sr25519" as const,
	}));

	const seedStore = (isConnected: boolean) => {
		const store = memoryStore();
		const talisman = { ...cachedWalletOf(walletId, "Talisman"), isConnected };
		if (isConnected) store.rememberWallet(talisman.id);
		store.setCachedState(
			[talisman],
			isConnected
				? addresses.map((address) => ({
						...cachedAccountOf(talisman, address),
						polkadotAccountType: "sr25519" as const,
					}))
				: [],
		);
		return store;
	};

	const record = (store: ReturnType<typeof memoryStore>) => {
		const states: KheopskitState[] = [];
		subscription = getKheopskit$(
			{ platforms: [polkadot()], hydrationGracePeriod: 500 },
			{ store },
		).subscribe((state) => states.push(state));
		return states;
	};

	const walletIn = (state: KheopskitState | undefined) =>
		state?.wallets.find((w) => w.id === walletId);

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		subscription?.unsubscribe();
		loadListeners.length = 0;
		vi.restoreAllMocks();
		Reflect.deleteProperty(document, "readyState");
		vi.useRealTimers();
	});

	describe("with the wallet injected", () => {
		let talisman: FakePolkadotExtension;

		beforeEach(() => {
			setReadyState("complete");
			talisman = install({ name: "talisman", accounts, enable: "hold" });
		});

		it("placeholders are flagged during hydration and gone after", async () => {
			const states = record(seedStore(true));
			await vi.advanceTimersByTimeAsync(300);
			talisman.resolveEnable();
			await vi.advanceTimersByTimeAsync(3700);

			const accountFlags = (state: KheopskitState) =>
				state.accounts.map((a) => [a.isPlaceholder, "txCreator" in a]);
			const firstLive = states.findIndex((s) =>
				s.accounts.some((a) => !a.isPlaceholder),
			);
			expect(firstLive).toBeGreaterThan(0);
			for (const state of states.slice(0, firstLive))
				expect(accountFlags(state)).toEqual([
					[true, false],
					[true, false],
				]);
			expect(accountFlags(states[firstLive] as KheopskitState)).toEqual([
				[false, true],
				[false, true],
			]);

			const ended = states.findIndex((s) => !s.isHydrating);
			expect(ended).toBeGreaterThan(-1);
			for (const state of states.slice(ended))
				expect(
					[...state.wallets, ...state.accounts].map((i) => i.isPlaceholder),
				).not.toContain(true);
		});

		it("a merged wallet is not a placeholder", async () => {
			const states = record(seedStore(true));

			await vi.advanceTimersByTimeAsync(100);
			const pending = walletIn(states.at(-1));
			expect([
				pending?.isPlaceholder,
				pending?.status,
				pending?.isConnected,
				pending && "sourceId" in pending ? pending.sourceId : undefined,
			]).toEqual([false, "connecting", false, "talisman"]);
			expect(states.at(-1)?.accounts.map((a) => a.isPlaceholder)).toEqual([
				true,
				true,
			]);

			talisman.resolveEnable();
			await vi.advanceTimersByTimeAsync(300);
			expect(walletIn(states.at(-1))).toMatchObject({
				isPlaceholder: false,
				status: "connected",
			});
			expect(states.at(-1)?.accounts.map((a) => a.isPlaceholder)).toEqual([
				false,
				false,
			]);
		});

		it("live accounts identical to their placeholders emit before hydration ends", async () => {
			talisman.setAccounts([]);
			const states = record(seedStore(true));
			await vi.advanceTimersByTimeAsync(0);
			talisman.resolveEnable();
			await vi.advanceTimersByTimeAsync(200);
			talisman.setAccounts(accounts);
			await vi.advanceTimersByTimeAsync(3800);

			const firstLive = states.findIndex((s) =>
				s.accounts.some((a) => !a.isPlaceholder),
			);
			expect(firstLive).toBeGreaterThan(0);
			expect(walletIn(states[firstLive - 1])?.status).toBe("connected");
			expect(
				states[firstLive]?.accounts.map((a) => [a.isPlaceholder, a.address]),
			).toEqual(addresses.map((address) => [false, address]));
			expect(states[firstLive]?.isHydrating).toBe(true);
		});
	});

	describe("placeholder connect defers to the live wallet", () => {
		beforeEach(() => {
			setReadyState("loading");
			captureLoadListeners();
		});

		const placeholderOf = async (states: KheopskitState[]) => {
			await vi.advanceTimersByTimeAsync(0);
			const placeholder = walletIn(states[0]);
			expect(placeholder?.isPlaceholder).toBe(true);
			return placeholder as NonNullable<typeof placeholder>;
		};

		it("connects the live wallet once it appears", async () => {
			const states = record(seedStore(false));
			const placeholder = await placeholderOf(states);

			let settledIn: KheopskitState | undefined;
			const connecting = placeholder.connect().then(() => {
				settledIn = states.at(-1);
			});
			await vi.advanceTimersByTimeAsync(200);

			const talisman = install({ name: "talisman", accounts });
			await fireLoad();
			await vi.advanceTimersByTimeAsync(200);
			await connecting;

			expect(talisman.enableCalls()).toHaveLength(1);
			expect(walletIn(settledIn)).toMatchObject({
				isPlaceholder: false,
				status: "connected",
				isConnected: true,
			});
		});

		it("does not enable an extension installed between discovery polls before discovery lists it", async () => {
			const states = record(seedStore(false));
			const placeholder = await placeholderOf(states);

			const talisman = install({ name: "talisman", accounts });
			const connecting = placeholder.connect();
			await vi.advanceTimersByTimeAsync(50);
			expect(walletIn(states.at(-1))?.isPlaceholder).toBe(true);
			expect(talisman.enableCalls()).toEqual([]);

			await vi.advanceTimersByTimeAsync(400);
			await connecting;
			expect(talisman.enableCalls()).toHaveLength(1);
		});

		it("rejects ABORTED when its signal aborts", async () => {
			const states = record(seedStore(false));
			const placeholder = await placeholderOf(states);

			const controller = new AbortController();
			let outcome: unknown = "pending";
			placeholder.connect({ signal: controller.signal }).then(
				() => {
					outcome = "resolved";
				},
				(error: unknown) => {
					outcome = error;
				},
			);
			await vi.advanceTimersByTimeAsync(100);
			controller.abort();
			await vi.advanceTimersByTimeAsync(0);
			expect(outcome).toMatchObject({ code: "ABORTED", walletId });

			const talisman = install({ name: "talisman", accounts });
			await fireLoad();
			await vi.advanceTimersByTimeAsync(200);
			expect(talisman.enableCalls()).toEqual([]);
		});

		it("rejects WALLET_PENDING when hydration ends without the wallet", async () => {
			const states = record(seedStore(false));
			const placeholder = await placeholderOf(states);

			let rejectedIn: KheopskitState | undefined;
			const result = placeholder.connect().catch((error: unknown) => {
				rejectedIn = states.at(-1);
				return error;
			});
			await vi.advanceTimersByTimeAsync(200);
			await fireLoad();
			await vi.advanceTimersByTimeAsync(4000);

			expect(await result).toMatchObject({ code: "WALLET_PENDING", walletId });
			expect(rejectedIn?.isHydrating).toBe(false);
		});

		it("rejects ABORTED without connecting when the consumer unsubscribes as the wallet goes live", async () => {
			const store = memoryStore();
			store.setCachedState(
				[
					{
						id: WALLET_CONNECT_WALLET_ID,
						type: "walletconnect",
						name: "WalletConnect",
						isConnected: false,
					},
				],
				[],
			);
			const isLive = (state: KheopskitState) =>
				state.wallets.some(
					(w) => w.id === WALLET_CONNECT_WALLET_ID && !w.isPlaceholder,
				);
			const connector$ = new BehaviorSubject<WalletConnectWallet | null>(null);
			const states: KheopskitState[] = [];
			subscription = getKheopskit$(
				{
					platforms: [polkadot()],
					hydrationGracePeriod: 500,
					walletConnect: {
						type: "walletconnect",
						metadata: {
							name: "Test Dapp",
							description: "",
							url: "",
							icons: [],
						},
						getWallet$: () => connector$,
					},
				},
				{ store },
			).subscribe((state) => {
				states.push(state);
				if (isLive(state)) subscription?.unsubscribe();
			});
			await vi.advanceTimersByTimeAsync(0);
			const placeholder = states[0]?.wallets.find(
				(w) => w.id === WALLET_CONNECT_WALLET_ID,
			);
			expect(placeholder?.isPlaceholder).toBe(true);

			const connect = vi.fn(async () => {});
			const result = placeholder?.connect().catch((error: unknown) => error);
			connector$.next({
				id: WALLET_CONNECT_WALLET_ID,
				type: "walletconnect",
				platforms: [],
				appKit: {} as AppKitInstance,
				name: "WalletConnect",
				icon: "",
				status: "disconnected",
				isConnected: false,
				connect,
				disconnect: async () => {},
			});
			await vi.advanceTimersByTimeAsync(200);

			expect(states.some(isLive)).toBe(true);
			expect(await result).toMatchObject({
				code: "ABORTED",
				walletId: WALLET_CONNECT_WALLET_ID,
			});
			expect(connect).not.toHaveBeenCalled();
		});

		it("a cached WalletConnect session's placeholder has no appKit and the restored connector has it", async () => {
			const store = memoryStore();
			store.setCachedState(
				[
					{
						id: WALLET_CONNECT_WALLET_ID,
						type: "walletconnect",
						name: "WalletConnect",
						isConnected: true,
					},
				],
				[],
			);
			const appKit: AppKitInstance = {
				getProvider: () => undefined,
				getAccount: () => undefined,
				getCaipNetworks: () => [],
			};
			const connector$ = new BehaviorSubject<WalletConnectWallet | null>(null);
			const states: KheopskitState[] = [];
			subscription = getKheopskit$(
				{
					platforms: [polkadot()],
					hydrationGracePeriod: 500,
					walletConnect: {
						type: "walletconnect",
						metadata: {
							name: "Test Dapp",
							description: "",
							url: "",
							icons: [],
						},
						getWallet$: () => connector$,
					},
				},
				{ store },
			).subscribe((state) => states.push(state));
			const connectorIn = (state: KheopskitState | undefined) =>
				state?.wallets.find(isWalletConnectWallet);
			const shape = (state: KheopskitState | undefined) => {
				const wallet = connectorIn(state);
				return (
					wallet && [wallet.isPlaceholder, wallet.status, "appKit" in wallet]
				);
			};

			await vi.advanceTimersByTimeAsync(0);
			connector$.next({
				id: WALLET_CONNECT_WALLET_ID,
				type: "walletconnect",
				platforms: [],
				appKit,
				name: "WalletConnect",
				icon: "",
				status: "connected",
				isConnected: true,
				connect: async () => {},
				disconnect: async () => {},
			});
			await vi.advanceTimersByTimeAsync(4000);

			expect(shape(states[0])).toEqual([true, "connecting", false]);
			expect(shape(states.at(-1))).toEqual([false, "connected", true]);
			const live = connectorIn(states.at(-1));
			expect(live && !live.isPlaceholder && live.appKit).toBe(appKit);
		});
	});
});

describe("getKheopskit$ hydration end", () => {
	let subscription: Subscription | undefined;
	const talisman = "polkadot:talisman" as WalletId;
	const subwallet = "polkadot:subwallet-js" as WalletId;
	const ALICE = {
		address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
		name: "Alice",
		type: "sr25519" as const,
	};
	const BOB = {
		address: "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty",
		name: "Bob",
		type: "sr25519" as const,
	};
	const CAROL = {
		address: "5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y",
		name: "Carol",
		type: "sr25519" as const,
	};
	const cachedAccount = (
		walletId: WalletId,
		address: string,
		name: string,
	): CachedAccount => ({
		id: `${walletId}::${address}`,
		platform: "polkadot",
		address,
		name,
		polkadotAccountType: "sr25519",
		walletId,
		walletName: "Talisman",
	});
	const cachedTalismanAccounts = [
		cachedAccount(talisman, "5CachedOne", "Cached one"),
		cachedAccount(talisman, "5CachedTwo", "Cached two"),
	];

	type FakeAccount = typeof ALICE;
	const heldTalisman = (accounts: FakeAccount[] = []) =>
		install({ name: "talisman", accounts, enable: "hold" });
	const resolveEnableAt = (fake: FakePolkadotExtension, ms: number) =>
		setTimeout(() => fake.resolveEnable(), ms);
	const rejectEnableAt = (
		fake: FakePolkadotExtension,
		ms: number,
		error: Error,
	) => setTimeout(() => fake.rejectEnable(error), ms);

	const cacheConnected = (
		store: ReturnType<typeof createKheopskitStore>,
		walletId: WalletId,
		accounts: CachedAccount[] = [],
	) => {
		store.rememberWallet(walletId);
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
			accounts,
		);
	};

	const subscribe = (
		config: Partial<KheopskitConfig>,
		store: ReturnType<typeof createKheopskitStore>,
	) => {
		const states: KheopskitState[] = [];
		subscription = getKheopskit$(
			{ platforms: [polkadot()], ...config },
			{ store },
		).subscribe((state) => states.push(state));
		return states;
	};

	const hydratingAt = async (states: KheopskitState[], ms: number) => {
		await vi.advanceTimersByTimeAsync(ms);
		return states.at(-1)?.isHydrating;
	};

	const walletIn = (states: KheopskitState[], id: WalletId) =>
		states.at(-1)?.wallets.find((w) => w.id === id);

	beforeEach(() => {
		vi.useFakeTimers();
		setReadyState("complete");
		captureLoadListeners();
	});

	afterEach(() => {
		subscription?.unsubscribe();
		loadListeners.length = 0;
		vi.restoreAllMocks();
		Reflect.deleteProperty(document, "readyState");
		vi.useRealTimers();
	});

	it("hydration ends at the grace period when autoReconnect is false and a cached connected wallet exists", async () => {
		const fake = heldTalisman();
		const store = memoryStore();
		cacheConnected(store, talisman, cachedTalismanAccounts);
		const states = subscribe(
			{ autoReconnect: false, hydrationGracePeriod: 500 },
			store,
		);

		expect(await hydratingAt(states, 499)).toBe(true);
		expect(await hydratingAt(states, 1)).toBe(false);
		expect(walletIn(states, talisman)?.status).toBe("disconnected");
		expect(fake.enableCalls()).toEqual([]);
	});

	it("hydration ends at the grace period when the cached connected wallet is no longer remembered", async () => {
		const fake = heldTalisman();
		const store = memoryStore();
		cacheConnected(store, talisman, cachedTalismanAccounts);
		store.forgetWallet(talisman);
		const states = subscribe({ hydrationGracePeriod: 500 }, store);

		expect(await hydratingAt(states, 499)).toBe(true);
		expect(await hydratingAt(states, 1)).toBe(false);
		expect(walletIn(states, talisman)?.status).toBe("disconnected");
		expect(states.at(-1)?.accounts).toEqual([]);
		expect(fake.enableCalls()).toEqual([]);
	});

	it("hydration ends when discovery settles and the remembered wallet is absent", async () => {
		setReadyState("interactive");
		const store = memoryStore();
		cacheConnected(store, talisman, cachedTalismanAccounts);
		const states = subscribe({ hydrationGracePeriod: 500 }, store);

		await vi.advanceTimersByTimeAsync(300);
		await fireLoad();
		expect(await hydratingAt(states, 199)).toBe(true);
		expect(await hydratingAt(states, 1)).toBe(false);
		expect(states.at(-1)?.wallets).toEqual([]);
		expect(states.at(-1)?.accounts).toEqual([]);
	});

	it("hydration ends at load when discovery settles after the grace period and the remembered wallet is absent", async () => {
		setReadyState("interactive");
		const store = memoryStore();
		cacheConnected(store, talisman, cachedTalismanAccounts);
		const states = subscribe({ hydrationGracePeriod: 200 }, store);

		expect(await hydratingAt(states, 300)).toBe(true);
		await fireLoad();
		expect(await hydratingAt(states, 1)).toBe(false);
	});

	it("hydration goes on past load while the wallet discovered at load reconnects", async () => {
		setReadyState("interactive");
		const store = memoryStore();
		cacheConnected(store, talisman, cachedTalismanAccounts);
		const states = subscribe({ hydrationGracePeriod: 200 }, store);

		await vi.advanceTimersByTimeAsync(300);
		resolveEnableAt(heldTalisman([ALICE, BOB]), 700);
		await fireLoad();
		expect(await hydratingAt(states, 699)).toBe(true);
		expect(walletIn(states, talisman)?.status).toBe("connecting");
		expect(await hydratingAt(states, 1)).toBe(false);
		expect(walletIn(states, talisman)?.status).toBe("connected");
		expect(states.at(-1)?.accounts.map((a) => a.address)).toEqual([
			ALICE.address,
			BOB.address,
		]);
	});

	it("hydration waits for the accounts of a reconnected wallet that lists them later", async () => {
		const fake = heldTalisman([]);
		resolveEnableAt(fake, 1000);
		setTimeout(() => fake.setAccounts([ALICE]), 1200);
		const store = memoryStore();
		cacheConnected(store, talisman, cachedTalismanAccounts);
		const states = subscribe({ hydrationGracePeriod: 500 }, store);

		expect(await hydratingAt(states, 1100)).toBe(true);
		expect(walletIn(states, talisman)?.status).toBe("connected");
		expect(states.at(-1)?.accounts.map((a) => a.address)).toEqual([
			"5CachedOne",
			"5CachedTwo",
		]);
		expect(await hydratingAt(states, 100)).toBe(false);
		expect(states.at(-1)?.accounts.map((a) => a.address)).toEqual([
			ALICE.address,
		]);
	});

	it("hydration waits for a reconnect in flight and ends when it settles", async () => {
		resolveEnableAt(heldTalisman([ALICE, BOB]), 1500);
		const store = memoryStore();
		cacheConnected(store, talisman, cachedTalismanAccounts);
		const states = subscribe({ hydrationGracePeriod: 500 }, store);

		expect(await hydratingAt(states, 1499)).toBe(true);
		expect(walletIn(states, talisman)?.status).toBe("connecting");
		expect(states.at(-1)?.accounts.map((a) => a.address)).toEqual([
			"5CachedOne",
			"5CachedTwo",
		]);
		expect(await hydratingAt(states, 1)).toBe(false);
		expect(walletIn(states, talisman)?.status).toBe("connected");
		expect(states.at(-1)?.accounts.map((a) => a.address)).toEqual([
			ALICE.address,
			BOB.address,
		]);
	});

	it("hydration ends when the reconnect fails", async () => {
		rejectEnableAt(heldTalisman(), 1500, new Error("boom"));
		const store = memoryStore();
		cacheConnected(store, talisman, cachedTalismanAccounts);
		const states = subscribe({ hydrationGracePeriod: 500 }, store);

		expect(await hydratingAt(states, 1499)).toBe(true);
		expect(await hydratingAt(states, 1)).toBe(false);
		const wallet = walletIn(states, talisman);
		expect([wallet?.status, wallet?.error?.code]).toEqual([
			"disconnected",
			"CONNECT_FAILED",
		]);
		expect(states.at(-1)?.accounts).toEqual([]);
	});

	it("hydration ends at hydrationTimeout when a reconnect never settles", async () => {
		heldTalisman();
		const store = memoryStore();
		cacheConnected(store, talisman, cachedTalismanAccounts);
		const states = subscribe(
			{ hydrationGracePeriod: 500, hydrationTimeout: 2000 },
			store,
		);

		expect(await hydratingAt(states, 1999)).toBe(true);
		expect(await hydratingAt(states, 1)).toBe(false);
		expect(await hydratingAt(states, 3000)).toBe(false);
		expect(walletIn(states, talisman)?.status).toBe("connecting");
		expect(states.at(-1)?.accounts).toEqual([]);
	});

	describe("persistence", () => {
		const writes = (store: ReturnType<typeof createKheopskitStore>) => {
			const calls: {
				wallets: { id: string; isConnected: boolean }[];
				accounts: { walletId: string; address: string; name?: string }[];
			}[] = [];
			vi.spyOn(store, "setCachedState").mockImplementation(
				(wallets, accounts) => {
					calls.push({
						wallets: wallets.map(({ id, isConnected }) => ({
							id,
							isConnected,
						})),
						accounts: accounts.map(({ walletId, address, name }) => ({
							walletId,
							address,
							name,
						})),
					});
				},
			);
			return calls;
		};
		const live = (walletId: WalletId, account: FakeAccount) => ({
			walletId,
			address: account.address,
			name: account.name,
		});
		const cached = (account: CachedAccount) => ({
			walletId: account.walletId,
			address: account.address,
			name: account.name,
		});

		it("a slow reconnect never writes an empty cache", async () => {
			resolveEnableAt(heldTalisman([ALICE, BOB]), 2500);
			const store = memoryStore();
			cacheConnected(store, talisman, cachedTalismanAccounts);
			const calls = writes(store);
			subscribe({ hydrationGracePeriod: 0 }, store);

			await vi.advanceTimersByTimeAsync(2499);
			expect(calls.length).toBeGreaterThanOrEqual(1);
			for (const call of calls)
				expect(call).toEqual({
					wallets: [{ id: talisman, isConnected: true }],
					accounts: cachedTalismanAccounts.map(cached),
				});

			await vi.advanceTimersByTimeAsync(1 + 1000);
			expect(calls.at(-1)).toEqual({
				wallets: [{ id: talisman, isConnected: true }],
				accounts: [live(talisman, ALICE), live(talisman, BOB)],
			});
		});

		it("a reconnect that fails after a kept write is written live", async () => {
			rejectEnableAt(heldTalisman(), 2500, new Error("boom"));
			const store = memoryStore();
			cacheConnected(store, talisman, cachedTalismanAccounts);
			const calls = writes(store);
			const states = subscribe({ hydrationGracePeriod: 0 }, store);

			await vi.advanceTimersByTimeAsync(2499);
			expect(calls.at(-1)).toEqual({
				wallets: [{ id: talisman, isConnected: true }],
				accounts: cachedTalismanAccounts.map(cached),
			});

			await vi.advanceTimersByTimeAsync(1 + 1000);
			expect(walletIn(states, talisman)?.error?.code).toBe("CONNECT_FAILED");
			expect(calls.at(-1)).toEqual({
				wallets: [{ id: talisman, isConnected: false }],
				accounts: [],
			});
		});

		it("a wallet the user connects while another reconnect is still pending is persisted", async () => {
			heldTalisman();
			install({ name: "subwallet-js", accounts: [CAROL] });
			const store = memoryStore();
			cacheConnected(store, talisman, cachedTalismanAccounts);
			const calls = writes(store);
			const states = subscribe(
				{ hydrationGracePeriod: 500, hydrationTimeout: 2000 },
				store,
			);

			await vi.advanceTimersByTimeAsync(1200);
			const connecting = walletIn(states, subwallet)?.connect();
			await vi.advanceTimersByTimeAsync(100);
			await connecting;
			expect(calls).toEqual([]);

			await vi.advanceTimersByTimeAsync(2000);
			expect(walletIn(states, talisman)?.status).toBe("connecting");
			expect(calls.at(-1)).toEqual({
				wallets: [
					{ id: talisman, isConnected: true },
					{ id: subwallet, isConnected: true },
				],
				accounts: [
					live(subwallet, CAROL),
					...cachedTalismanAccounts.map(cached),
				],
			});
		});
	});
});
