import { connectInjectedExtension } from "polkadot-api/pjs-signer";
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
import type { WalletId } from "../utils/WalletId";
import { getAccounts$ } from "./accounts";
import { getKheopskit$ } from "./kheopskit";
import { polkadot } from "./polkadot/plugin";
import type { PolkadotAccount, PolkadotWallet } from "./polkadot/types";
import { createKheopskitStore } from "./store";
import type {
	KheopskitConfig,
	KheopskitState,
	WalletConnectWallet,
} from "./types";
import { getWallets$ } from "./wallets";

const { injected, walletConnect } = vi.hoisted(() => ({
	injected: { names: [] as string[] },
	walletConnect: {
		connector$: undefined as unknown as Subject<WalletConnectWallet | null>,
	},
}));

vi.mock("polkadot-api/pjs-signer", () => ({
	getInjectedExtensions: () => injected.names,
	connectInjectedExtension: vi.fn(),
}));

vi.mock("./wallets", () => ({
	getWallets$: vi.fn(() => of([])),
}));

vi.mock("./accounts", () => ({
	getAccounts$: vi.fn(() => of([])),
}));

vi.mock("./appKit", () => ({
	getWalletConnectWallet$: () => walletConnect.connector$,
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

	beforeEach(async () => {
		localStorage.clear();
		vi.useFakeTimers();
		injected.names = [];
		walletConnect.connector$ = new Subject();
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
			{ platforms: [polkadot()] },
			{ store },
		).subscribe((state) => states.push(state));

		await vi.advanceTimersByTimeAsync(1200);
		injected.names = ["talisman"];
		await fireLoad();
		await vi.advanceTimersByTimeAsync(20);
		walletConnect.connector$.next(null);
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
		walletConnect.connector$ = new BehaviorSubject<WalletConnectWallet | null>(
			null,
		);
		const actual =
			await vi.importActual<typeof import("./wallets")>("./wallets");
		vi.mocked(getWallets$).mockImplementation(actual.getWallets$);
		vi.mocked(connectInjectedExtension).mockImplementation(
			() =>
				new Promise((resolve) =>
					setTimeout(() => resolve({ disconnect: vi.fn() } as never), 300),
				),
		);
	});

	afterEach(() => {
		subscription?.unsubscribe();
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
