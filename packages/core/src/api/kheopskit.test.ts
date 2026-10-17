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
import { WALLET_CONNECT_WALLET_ID } from "../utils/WalletId";
import { getKheopskit$ } from "./kheopskit";
import { polkadot } from "./polkadot/plugin";
import { createKheopskitStore } from "./store";
import {
	type AppKitInstance,
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
