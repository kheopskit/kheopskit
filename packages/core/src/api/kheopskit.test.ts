import {
	BehaviorSubject,
	firstValueFrom,
	of,
	Subject,
	type Subscription,
	take,
} from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWalletAccountId } from "../utils/WalletAccountId";
import { WALLET_CONNECT_WALLET_ID, type WalletId } from "../utils/WalletId";
import { getAccounts$ } from "./accounts";
import { getKheopskit$ } from "./kheopskit";
import { polkadot } from "./polkadot/plugin";
import type { PolkadotAccount, PolkadotWallet } from "./polkadot/types";
import { createKheopskitStore } from "./store";
import {
	type AppKitInstance,
	isWalletConnectWallet,
	type KheopskitConfig,
	type KheopskitState,
	type WalletConnectPlugin,
	type WalletConnectWallet,
} from "./types";
import { getWallets$ } from "./wallets";

const { injected } = vi.hoisted(() => ({
	injected: { names: [] as string[] },
}));

vi.mock("polkadot-api/pjs-signer", () => ({
	getInjectedExtensions: () => injected.names,
	getTxCreatorFromPjs: (address: string) => ({ address }),
}));

vi.mock("./wallets", () => ({
	getWallets$: vi.fn(() => of([])),
}));

vi.mock("./accounts", () => ({
	getAccounts$: vi.fn(() => of([])),
}));

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

		const { getKheopskit$ } = await import("./kheopskit");
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

		const { getKheopskit$ } = await import("./kheopskit");
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

describe("getKheopskit$ discovery", () => {
	let subscription: Subscription | undefined;

	const recordStates = () => {
		const states: KheopskitState[] = [];
		subscription = getKheopskit$({ platforms: [polkadot()] }).subscribe(
			(state) => states.push(state),
		);
		return states;
	};

	beforeEach(() => {
		localStorage.clear();
		vi.useFakeTimers();
		injected.names = [];
		vi.mocked(getWallets$).mockImplementation((config, store) =>
			polkadot().getWallets$({ config, store }),
		);
		captureLoadListeners();
	});

	afterEach(() => {
		subscription?.unsubscribe();
		loadListeners.length = 0;
		vi.restoreAllMocks();
		Reflect.deleteProperty(document, "readyState");
		vi.useRealTimers();
		vi.mocked(getWallets$).mockImplementation(() => of([]));
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
		injected.names = ["talisman"];
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

	beforeEach(async () => {
		localStorage.clear();
		vi.useFakeTimers();
		injected.names = [];
		connector$ = new Subject();
		const actual =
			await vi.importActual<typeof import("./wallets")>("./wallets");
		vi.mocked(getWallets$).mockImplementation(actual.getWallets$);
		captureLoadListeners();
	});

	afterEach(() => {
		subscription?.unsubscribe();
		loadListeners.length = 0;
		vi.restoreAllMocks();
		Reflect.deleteProperty(document, "readyState");
		vi.useRealTimers();
		vi.mocked(getWallets$).mockImplementation(() => of([]));
	});

	it("with a cached state, the emission that ends discovery already lists the extension present at load", async () => {
		setReadyState("interactive");
		const store = createKheopskitStore();
		store.setCachedState(
			[
				{
					id: "polkadot:cached" as WalletId,
					platform: "polkadot",
					type: "injected",
					name: "Cached",
					isConnected: false,
				},
			],
			[],
		);
		const states: KheopskitState[] = [];
		subscription = getKheopskit$(
			{ platforms: [polkadot()], walletConnect: walletConnectPlugin },
			{ store },
		).subscribe((state) => states.push(state));

		await vi.advanceTimersByTimeAsync(1200);
		injected.names = ["talisman"];
		await fireLoad();
		await vi.advanceTimersByTimeAsync(20);
		connector$.next(null);
		await vi.advanceTimersByTimeAsync(20);

		const settled = states.find((s) => s.isDiscovering === false);
		expect(settled?.wallets.map((w) => w.id)).toEqual(["polkadot:talisman"]);
	});
});

describe("getKheopskit$ account changes", () => {
	const walletId = "polkadot:talisman" as WalletId;
	const address = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
	const config: KheopskitConfig = {
		platforms: [polkadot({ accountTypes: ["sr25519"] })],
		autoReconnect: true,
		debug: false,
		storageKey: "kheopskit",
		hydrationGracePeriod: 500,
	};

	beforeEach(() => {
		localStorage.clear();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("re-emits and re-persists when an account is renamed", async () => {
		const wallet = {
			id: walletId,
			platform: "polkadot",
			type: "injected",
			name: "Talisman",
			icon: "",
			isConnected: true,
		} as PolkadotWallet;
		const account = {
			id: getWalletAccountId(walletId, address),
			platform: "polkadot",
			address,
			name: "Alice",
			type: "sr25519",
			walletId,
			walletName: "Talisman",
		} as PolkadotAccount;
		const accounts$ = new BehaviorSubject([account]);
		vi.mocked(getWallets$).mockReturnValueOnce(of([wallet]));
		vi.mocked(getAccounts$).mockReturnValueOnce(accounts$);

		const store = createKheopskitStore();
		const { getKheopskit$ } = await import("./kheopskit");
		const states: KheopskitState[] = [];
		const sub = getKheopskit$(config, { store }).subscribe((state) =>
			states.push(state),
		);
		await vi.advanceTimersByTimeAsync(2000);
		expect(store.getCachedState().accounts[0]?.name).toBe("Alice");
		const emissionsBeforeRename = states.length;

		accounts$.next([{ ...account, name: "Alice (renamed)" }]);
		await vi.advanceTimersByTimeAsync(100);

		expect(states).toHaveLength(emissionsBeforeRename + 1);
		expect(states.at(-1)?.accounts[0]?.name).toBe("Alice (renamed)");
		expect(store.getCachedState().accounts[0]?.name).toBe("Alice");

		await vi.advanceTimersByTimeAsync(1000);
		expect(store.getCachedState().accounts[0]?.name).toBe("Alice (renamed)");
		sub.unsubscribe();
	});
});

describe("getKheopskit$ reload with a cached connected wallet", () => {
	let subscription: Subscription | undefined;
	const walletId = "polkadot:talisman" as WalletId;
	const cachedAccount = {
		id: `${walletId}::5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY`,
		platform: "polkadot" as const,
		address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
		walletId,
		walletName: "Talisman",
	};

	beforeEach(async () => {
		localStorage.clear();
		vi.useFakeTimers();
		setReadyState("complete");
		injected.names = ["talisman"];
		const actual =
			await vi.importActual<typeof import("./wallets")>("./wallets");
		vi.mocked(getWallets$).mockImplementation(actual.getWallets$);
		window.injectedWeb3 = {
			talisman: {
				enable: () =>
					new Promise((resolve) =>
						setTimeout(
							() =>
								resolve({
									accounts: { get: async () => [], subscribe: () => () => {} },
									signer: { signPayload: vi.fn(), signRaw: vi.fn() },
								}),
							300,
						),
					),
			},
		};
	});

	afterEach(() => {
		subscription?.unsubscribe();
		delete window.injectedWeb3;
		vi.restoreAllMocks();
		Reflect.deleteProperty(document, "readyState");
		vi.useRealTimers();
		vi.mocked(getWallets$).mockImplementation(() => of([]));
	});

	const statusesOf = (states: KheopskitState[]) =>
		states
			.map((s) => s.wallets.find((w) => w.id === walletId)?.status)
			.filter((status, i, all) => i === 0 || status !== all[i - 1]);

	it("isConnected is true only when status is connected", async () => {
		const store = createKheopskitStore();
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
			[cachedAccount],
		);
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

		await vi.advanceTimersByTimeAsync(300);
		const after = states.at(-1)?.wallets.find((w) => w.id === walletId);
		expect([after?.status, after?.isConnected]).toEqual(["connected", true]);

		expect(statusesOf(states)).toEqual(["connecting", "connected"]);
		for (const state of states)
			for (const wallet of state.wallets)
				expect(wallet.isConnected).toBe(wallet.status === "connected");
	});
});

describe("getKheopskit$ placeholders", () => {
	let subscription: Subscription | undefined;
	const walletId = "polkadot:talisman" as WalletId;
	const addresses = [
		"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
		"5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty",
	];
	const injectedAccounts = addresses.map((address) => ({
		address,
		type: "sr25519" as const,
	}));
	const extensionListing = (accounts: {
		get: () => Promise<typeof injectedAccounts>;
		subscribe: (
			callback: (list: typeof injectedAccounts) => void,
		) => () => void;
	}) => ({ accounts, signer: { signPayload: vi.fn(), signRaw: vi.fn() } });
	const extension = extensionListing({
		get: async () => injectedAccounts,
		subscribe: () => () => {},
	});
	const enable = vi.fn<() => Promise<unknown>>();

	const seedStore = (isConnected: boolean) => {
		const store = createKheopskitStore();
		if (isConnected) store.rememberWallet(walletId);
		store.setCachedState(
			[
				{
					id: walletId,
					platform: "polkadot",
					type: "injected",
					name: "Talisman",
					isConnected,
				},
			],
			isConnected
				? addresses.map((address) => ({
						id: getWalletAccountId(walletId, address),
						platform: "polkadot" as const,
						address,
						polkadotAccountType: "sr25519" as const,
						walletId,
						walletName: "Talisman",
					}))
				: [],
		);
		return store;
	};

	const record = (store: ReturnType<typeof createKheopskitStore>) => {
		const states: KheopskitState[] = [];
		subscription = getKheopskit$(
			{ platforms: [polkadot()], hydrationGracePeriod: 500 },
			{ store },
		).subscribe((state) => states.push(state));
		return states;
	};

	const walletIn = (state: KheopskitState | undefined) =>
		state?.wallets.find((w) => w.id === walletId);

	const enableAfter = (ms: number) =>
		enable.mockImplementation(
			() => new Promise((resolve) => setTimeout(() => resolve(extension), ms)),
		);

	beforeEach(async () => {
		localStorage.clear();
		vi.useFakeTimers();
		enable.mockReset();
		window.injectedWeb3 = { talisman: { enable } } as never;
		const actualWallets =
			await vi.importActual<typeof import("./wallets")>("./wallets");
		const actualAccounts =
			await vi.importActual<typeof import("./accounts")>("./accounts");
		vi.mocked(getWallets$).mockImplementation(actualWallets.getWallets$);
		vi.mocked(getAccounts$).mockImplementation(actualAccounts.getAccounts$);
	});

	afterEach(() => {
		subscription?.unsubscribe();
		loadListeners.length = 0;
		vi.restoreAllMocks();
		Reflect.deleteProperty(document, "readyState");
		vi.useRealTimers();
		vi.mocked(getWallets$).mockImplementation(() => of([]));
		vi.mocked(getAccounts$).mockImplementation(() => of([]));
		delete window.injectedWeb3;
	});

	describe("with the wallet injected", () => {
		beforeEach(() => {
			setReadyState("complete");
			injected.names = ["talisman"];
			enableAfter(300);
		});

		it("placeholders are flagged during hydration and gone after", async () => {
			const states = record(seedStore(true));
			await vi.advanceTimersByTimeAsync(4000);

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
			enable.mockImplementation(async () =>
				extensionListing({
					get: async () => [],
					subscribe: (callback) => {
						const timeout = setTimeout(() => callback(injectedAccounts), 200);
						return () => clearTimeout(timeout);
					},
				}),
			);
			const states = record(seedStore(true));
			await vi.advanceTimersByTimeAsync(4000);

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
			injected.names = [];
			captureLoadListeners();
			enableAfter(50);
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
			expect(enable).not.toHaveBeenCalled();

			injected.names = ["talisman"];
			await fireLoad();
			await vi.advanceTimersByTimeAsync(200);
			await connecting;

			expect(enable).toHaveBeenCalledTimes(1);
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

			injected.names = ["talisman"];
			await fireLoad();
			await vi.advanceTimersByTimeAsync(200);
			expect(enable).not.toHaveBeenCalled();
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
			expect(enable).not.toHaveBeenCalled();
		});

		it("rejects ABORTED without connecting when the consumer unsubscribes as the wallet goes live", async () => {
			const store = createKheopskitStore();
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
			const store = createKheopskitStore();
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
