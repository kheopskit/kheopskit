import { announceProvider, type EIP6963ProviderDetail } from "mipd";
import {
	BehaviorSubject,
	filter,
	firstValueFrom,
	type Observable,
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
import { clearCachedObservable } from "../utils/getCachedObservable";
import type { WalletId } from "../utils/WalletId";
import type { KheopskitError } from "./errors";
import { ethereum } from "./ethereum/plugin";
import {
	createInstance,
	createKheopskit,
	kheopskitInternals,
} from "./instance";
import { polkadot } from "./polkadot/plugin";
import { createKheopskitStore } from "./store";
import type { KheopskitState, KheopskitStore } from "./types";

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const BOB = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
const ETH_ADDRESS = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const ETH_RDNS = "io.kheopskit.fake";
const UNHELD =
	"was called while nothing subscribes this kheopskit instance's kheopskit$ (a mounted, visible KheopskitProvider subscribes it)";

type Settlement = "pending" | "resolved" | `rejected:${string}`;

const settlementOf = (promise: Promise<unknown>) => {
	let settled: Settlement = "pending";
	promise.then(
		() => {
			settled = "resolved";
		},
		(error: KheopskitError) => {
			settled = `rejected:${error.code}: ${error.message}`;
		},
	);
	return () => settled;
};

const flushMicrotasks = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

const stateWith = (walletId: WalletId, connect: () => Promise<void>) =>
	({
		wallets: [{ id: walletId, status: "disconnected", connect }],
		accounts: [],
		isHydrating: false,
		isDiscovering: false,
	}) as unknown as KheopskitState;

const runsOf = <T>(create: () => Observable<T>) => {
	const runs: Observable<T>[] = [];
	return {
		runs,
		run$: () => {
			const run = create();
			runs.push(run);
			return run;
		},
	};
};

describe("createKheopskit", () => {
	let fake: FakePolkadotExtension;
	let storage: ReturnType<typeof createMemoryStorage>;
	let store: KheopskitStore;
	const holds: Subscription[] = [];

	beforeEach(() => {
		vi.useFakeTimers();
		fake = createFakePolkadotExtension({
			name: "talisman",
			accounts: [{ address: ALICE, name: "Alice" }],
		});
		storage = createMemoryStorage();
		store = createKheopskitStore({ storage });
	});

	afterEach(() => {
		for (const hold of holds.splice(0)) hold.unsubscribe();
		fake.uninstall();
		store.destroy();
		vi.restoreAllMocks();
		localStorage.clear();
		vi.useRealTimers();
	});

	const hold = (kit: { kheopskit$: Observable<KheopskitState> }) => {
		const subscription = kit.kheopskit$.subscribe();
		holds.push(subscription);
		return subscription;
	};

	const discovered = async (kit: {
		kheopskit$: Observable<KheopskitState>;
	}) => {
		await vi.advanceTimersByTimeAsync(1000);
		return firstValueFrom(
			kit.kheopskit$.pipe(
				filter((state) =>
					state.wallets.some(
						(wallet) => wallet.id === fake.walletId && !state.isHydrating,
					),
				),
			),
		);
	};

	it("runs one pipeline for every subscriber", async () => {
		store.rememberWallet(fake.walletId);
		const plugin = polkadot();
		const getWallets$ = vi.spyOn(plugin, "getWallets$");
		const kit = createKheopskit({ platforms: [plugin] }, { store });

		hold(kit);
		hold(kit);
		await vi.advanceTimersByTimeAsync(1000);

		expect({
			enableCalls: fake.enableCalls().length,
			walletSources: getWallets$.mock.calls.length,
		}).toEqual({ enableCalls: 1, walletSources: 1 });
	});

	it("stops the run when the last subscriber leaves", async () => {
		store.rememberWallet(fake.walletId);
		const kit = createKheopskit({ platforms: [polkadot()] }, { store });
		const first = hold(kit);
		const second = hold(kit);
		const setItem = vi.spyOn(storage, "setItem");

		first.unsubscribe();
		second.unsubscribe();
		await vi.advanceTimersByTimeAsync(5000);

		expect({
			timers: vi.getTimerCount(),
			writes: setItem.mock.calls.length,
		}).toEqual({ timers: 0, writes: 0 });
	});

	it("starts the next run from the cache as it stands then", async () => {
		const kit = createKheopskit({ platforms: [polkadot()] }, { store });
		hold(kit).unsubscribe();
		await vi.advanceTimersByTimeAsync(1000);
		fake.uninstall();
		const cached = cachedWalletOf("polkadot:subwallet-js", "SubWallet");
		store.setCachedState([cached], []);
		store.rememberWallet(cached.id);

		const first = await firstValueFrom(kit.kheopskit$);

		expect(first.wallets.map((wallet) => wallet.id)).toEqual([cached.id]);
	});

	it("connects a wallet read from a stopped run through the run held now", async () => {
		const kit = createKheopskit({ platforms: [polkadot()] }, { store });
		const firstRun = hold(kit);
		const { wallets } = await discovered(kit);
		firstRun.unsubscribe();
		await vi.advanceTimersByTimeAsync(1000);
		hold(kit);
		await vi.advanceTimersByTimeAsync(1000);

		const connect = settlementOf(
			wallets.find((wallet) => wallet.id === fake.walletId)?.connect() ??
				Promise.reject(new Error("no wallet")),
		);
		await vi.advanceTimersByTimeAsync(1000);

		expect({
			connect: connect(),
			enableCalls: fake.enableCalls().length,
			remembered: (await firstValueFrom(store.observable)).remembered,
		}).toEqual({
			connect: "resolved",
			enableCalls: 1,
			remembered: [fake.walletId],
		});
	});

	it("rejects ABORTED for a wallet called inside take(1)'s next with no other subscriber", async () => {
		const kit = createKheopskit({ platforms: [polkadot()] }, { store });
		let connect: (() => Settlement) | undefined;
		holds.push(
			kit.kheopskit$
				.pipe(
					filter((state) =>
						state.wallets.some(
							(wallet) => wallet.id === fake.walletId && !state.isHydrating,
						),
					),
					take(1),
				)
				.subscribe((state) => {
					const wallet = state.wallets.find(({ id }) => id === fake.walletId);
					if (wallet) connect = settlementOf(wallet.connect());
				}),
		);
		await vi.advanceTimersByTimeAsync(1000);

		expect({
			connect: connect?.(),
			enableCalls: fake.enableCalls().length,
			timers: vi.getTimerCount(),
		}).toEqual({
			connect: `rejected:ABORTED: [kheopskit] connect of wallet ${fake.walletId} ${UNHELD}`,
			enableCalls: 0,
			timers: 0,
		});
	});

	describe("{ ssr: true }", () => {
		afterEach(() => {
			for (const cookie of document.cookie.split(";")) {
				const name = cookie.split("=")[0]?.trim();
				if (name)
					// biome-ignore lint/suspicious/noDocumentCookie: necessary for test cleanup
					document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
			}
		});

		it("persists to the cookie when a module-level subscribe is the first touch", async () => {
			const kit = createKheopskit({ platforms: [polkadot()] }, { ssr: true });
			hold(kit);
			const { wallets } = await discovered(kit);

			const connect = settlementOf(
				wallets.find((wallet) => wallet.id === fake.walletId)?.connect() ??
					Promise.reject(new Error("no wallet")),
			);
			await vi.advanceTimersByTimeAsync(1000);

			expect({
				connect: connect(),
				cookie: document.cookie.includes("kheopskit="),
				localStorage: localStorage.length,
			}).toEqual({ connect: "resolved", cookie: true, localStorage: 0 });
		});
	});

	it("touches no storage until kheopskit$ is subscribed or a store method is called", () => {
		const getItem = vi.spyOn(Storage.prototype, "getItem");
		const setItem = vi.spyOn(Storage.prototype, "setItem");

		const kit = createKheopskit({ platforms: [polkadot()] });
		const { store: lazyStore } = kit;
		const untouched = getItem.mock.calls.length + setItem.mock.calls.length;
		lazyStore.getCachedState();

		expect({
			untouched,
			touched: getItem.mock.calls.length > 0,
		}).toEqual({ untouched: 0, touched: true });
	});
});

describe("waitForAccount", () => {
	let fake: FakePolkadotExtension;
	let store: KheopskitStore;
	const holds: Subscription[] = [];
	const accountId = `polkadot:talisman::${ALICE}`;
	const waitedFor = (aborted: string) =>
		`rejected:ABORTED: [kheopskit] waitForAccount of account ${accountId} ${aborted}`;

	beforeEach(() => {
		vi.useFakeTimers();
		fake = createFakePolkadotExtension({
			name: "talisman",
			accounts: [{ address: ALICE, name: "Alice" }],
			enable: "hold",
		});
		store = createKheopskitStore({ storage: createMemoryStorage() });
		const wallet = cachedWalletOf(fake.walletId, "Talisman");
		store.setCachedState([wallet], [cachedAccountOf(wallet, ALICE)]);
		store.rememberWallet(fake.walletId);
	});

	afterEach(() => {
		for (const hold of holds.splice(0)) hold.unsubscribe();
		fake.uninstall();
		store.destroy();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	const reloaded = () => {
		const kit = createKheopskit({ platforms: [polkadot()] }, { store });
		const states: KheopskitState[] = [];
		const subscription = kit.kheopskit$.subscribe((state) => {
			states.push(state);
		});
		holds.push(subscription);
		return { kit, states, subscription };
	};

	it("resolves with the live account once its cached wallet reconnects", async () => {
		const { kit, states } = reloaded();
		const waiting = kit.waitForAccount(accountId);
		const settlement = settlementOf(waiting);
		await vi.advanceTimersByTimeAsync(2000);
		const beforeReconnect = settlement();
		fake.resolveEnable();
		await vi.advanceTimersByTimeAsync(100);
		const account = await waiting;

		expect({
			beforeReconnect,
			isPlaceholder: account.isPlaceholder,
			emitted:
				account ===
				states.at(-1)?.accounts.find((candidate) => candidate.id === accountId),
		}).toEqual({
			beforeReconnect: "pending",
			isPlaceholder: false,
			emitted: true,
		});
	});

	it("resolves at once with the account when it is already live", async () => {
		const { kit, states } = reloaded();
		await vi.advanceTimersByTimeAsync(2000);
		fake.resolveEnable();
		await vi.advanceTimersByTimeAsync(100);
		const live = states
			.at(-1)
			?.accounts.find((candidate) => candidate.id === accountId);

		const waiting = kit.waitForAccount(accountId);
		const settlement = settlementOf(waiting);
		await flushMicrotasks();

		expect({
			isPlaceholder: live?.isPlaceholder,
			settlement: settlement(),
			emitted: (await waiting) === live,
		}).toEqual({ isPlaceholder: false, settlement: "resolved", emitted: true });
	});

	it("keeps waiting while the extension injects after hydrationTimeout but before the page load, and resolves at the reconnect", async () => {
		const readyState = vi
			.spyOn(document, "readyState", "get")
			.mockReturnValue("interactive");
		fake.uninstall();
		const { kit, states } = reloaded();
		const settlement = settlementOf(kit.waitForAccount(accountId));
		await vi.advanceTimersByTimeAsync(8000);
		const beforeLoad = {
			settlement: settlement(),
			isHydrating: states.at(-1)?.isHydrating,
			isDiscovering: states.at(-1)?.isDiscovering,
			walletListed: states
				.at(-1)
				?.wallets.some((wallet) => wallet.id === fake.walletId),
		};
		fake = createFakePolkadotExtension({
			name: "talisman",
			accounts: [{ address: ALICE, name: "Alice" }],
			enable: "hold",
		});
		readyState.mockReturnValue("complete");
		window.dispatchEvent(new Event("load"));
		await vi.advanceTimersByTimeAsync(100);
		const beforeReconnect = settlement();
		fake.resolveEnable();
		await vi.advanceTimersByTimeAsync(100);

		expect({
			beforeLoad,
			beforeReconnect,
			afterReconnect: settlement(),
		}).toEqual({
			beforeLoad: {
				settlement: "pending",
				isHydrating: false,
				isDiscovering: true,
				walletListed: false,
			},
			beforeReconnect: "pending",
			afterReconnect: "resolved",
		});
	});

	it("rejects ACCOUNT_UNAVAILABLE when the reconnected wallet no longer lists the account", async () => {
		const { kit } = reloaded();
		const settlement = settlementOf(kit.waitForAccount(accountId));
		fake.setAccounts([{ address: BOB, name: "Bob" }]);
		await vi.advanceTimersByTimeAsync(2000);
		fake.resolveEnable();
		await vi.advanceTimersByTimeAsync(5000);

		expect(settlement()).toBe(
			`rejected:ACCOUNT_UNAVAILABLE: [kheopskit] wallet ${fake.walletId} settled without listing account ${accountId}`,
		);
	});

	it("keeps waiting past hydrationTimeout while the wallet is still connecting", async () => {
		const { kit, states } = reloaded();
		const settlement = settlementOf(kit.waitForAccount(accountId));
		await vi.advanceTimersByTimeAsync(4000);
		const afterTimeout = {
			settlement: settlement(),
			isHydrating: states.at(-1)?.isHydrating,
			status: states.at(-1)?.wallets.find(({ id }) => id === fake.walletId)
				?.status,
		};
		fake.resolveEnable();
		await vi.advanceTimersByTimeAsync(100);

		expect({ afterTimeout, afterReconnect: settlement() }).toEqual({
			afterTimeout: {
				settlement: "pending",
				isHydrating: false,
				status: "connecting",
			},
			afterReconnect: "resolved",
		});
	});

	it("rejects ABORTED while nothing subscribes, and starts no run", async () => {
		const kit = createKheopskit({ platforms: [polkadot()] }, { store });

		const settlement = settlementOf(kit.waitForAccount(accountId));
		await vi.advanceTimersByTimeAsync(1000);

		expect({
			settlement: settlement(),
			enableCalls: fake.enableCalls(),
		}).toEqual({ settlement: waitedFor(UNHELD), enableCalls: [] });
	});

	it("rejects ABORTED when the last subscriber leaves while it waits, and leaves no timer", async () => {
		const { kit, subscription } = reloaded();
		const settlement = settlementOf(kit.waitForAccount(accountId));
		await vi.advanceTimersByTimeAsync(1000);

		subscription.unsubscribe();
		await vi.advanceTimersByTimeAsync(5000);

		expect({
			settlement: settlement(),
			timers: vi.getTimerCount(),
		}).toEqual({ settlement: waitedFor(UNHELD), timers: 0 });
	});

	it("rejects ABORTED when its signal fired before or during the wait, and removes every listener it added", async () => {
		const { kit } = reloaded();
		const listenersOf = (signal: AbortSignal) => {
			const added = vi.spyOn(signal, "addEventListener");
			const removed = vi.spyOn(signal, "removeEventListener");
			return () => ({
				added: added.mock.calls.length,
				removed: removed.mock.calls.length,
			});
		};
		const before = new AbortController();
		before.abort();
		const during = new AbortController();
		const resolved = new AbortController();
		const listeners = {
			before: listenersOf(before.signal),
			during: listenersOf(during.signal),
			resolved: listenersOf(resolved.signal),
		};

		const settlements = {
			before: settlementOf(
				kit.waitForAccount(accountId, { signal: before.signal }),
			),
			during: settlementOf(
				kit.waitForAccount(accountId, { signal: during.signal }),
			),
			resolved: settlementOf(
				kit.waitForAccount(accountId, { signal: resolved.signal }),
			),
		};
		await vi.advanceTimersByTimeAsync(1000);
		during.abort();
		fake.resolveEnable();
		await vi.advanceTimersByTimeAsync(100);

		expect({
			before: settlements.before(),
			during: settlements.during(),
			resolved: settlements.resolved(),
			listeners: {
				before: listeners.before(),
				during: listeners.during(),
				resolved: listeners.resolved(),
			},
		}).toEqual({
			before: waitedFor("was aborted"),
			during: waitedFor("was aborted"),
			resolved: "resolved",
			listeners: {
				before: { added: 0, removed: 0 },
				during: { added: 1, removed: 1 },
				resolved: { added: 1, removed: 1 },
			},
		});
	});
});

describe("waitForAccount on Ethereum, while eth_accounts has not answered", () => {
	const walletId = `ethereum:${ETH_RDNS}` as const;
	const accountId = `${walletId}::${ETH_ADDRESS}` as const;
	const holds: Subscription[] = [];
	let answerAccounts: Array<(addresses: string[]) => void>;
	let unannounce: () => void;
	let store: KheopskitStore;

	beforeEach(() => {
		vi.useFakeTimers();
		answerAccounts = [];
		const provider = {
			request: async ({ method }: { method: string }) => {
				if (method === "eth_requestAccounts") return [ETH_ADDRESS];
				if (method === "eth_chainId") return "0x1";
				if (method === "eth_accounts")
					return new Promise<string[]>((resolve) =>
						answerAccounts.push(resolve),
					);
				throw new Error(`unexpected request ${method}`);
			},
			on: () => {},
			removeListener: () => {},
		};
		unannounce = announceProvider({
			info: {
				uuid: "00000000-0000-4000-8000-000000000001",
				name: "Fake",
				icon: "data:image/svg+xml,",
				rdns: ETH_RDNS,
			},
			provider: provider as unknown as EIP6963ProviderDetail["provider"],
		});
		store = createKheopskitStore({ storage: createMemoryStorage() });
	});

	afterEach(() => {
		for (const hold of holds.splice(0)) hold.unsubscribe();
		unannounce();
		clearCachedObservable(`accounts:${walletId}`);
		store.destroy();
		vi.useRealTimers();
	});

	const subscribed = (kit: { kheopskit$: Observable<KheopskitState> }) => {
		const states: KheopskitState[] = [];
		holds.push(kit.kheopskit$.subscribe((state) => states.push(state)));
		const wallet = () =>
			states.at(-1)?.wallets.find((candidate) => candidate.id === walletId);
		return {
			observed: (settlement: () => Settlement) => ({
				settlement: settlement(),
				isHydrating: states.at(-1)?.isHydrating,
				isConnected: wallet()?.isConnected,
				accounts: states.at(-1)?.accounts.length,
			}),
			connect: () => wallet()?.connect(),
		};
	};

	it("keeps waiting after a fresh connect, and resolves once eth_accounts answers", async () => {
		const kit = createKheopskit(
			{ platforms: [ethereum()], autoReconnect: false },
			{ store },
		);
		const { observed, connect } = subscribed(kit);
		await vi.advanceTimersByTimeAsync(1000);
		await connect();
		const settlement = settlementOf(kit.waitForAccount(accountId));
		await vi.advanceTimersByTimeAsync(5000);
		const beforeAnswer = observed(settlement);
		for (const answer of answerAccounts.splice(0)) answer([ETH_ADDRESS]);
		await vi.advanceTimersByTimeAsync(100);

		expect({ beforeAnswer, afterAnswer: settlement() }).toEqual({
			beforeAnswer: {
				settlement: "pending",
				isHydrating: false,
				isConnected: true,
				accounts: 0,
			},
			afterAnswer: "resolved",
		});
	});

	it("keeps waiting after a reload whose eth_accounts outlasts hydrationTimeout, and resolves once it answers", async () => {
		const wallet = cachedWalletOf(walletId, "Fake");
		store.setCachedState([wallet], [cachedAccountOf(wallet, ETH_ADDRESS)]);
		store.rememberWallet(walletId);
		const kit = createKheopskit({ platforms: [ethereum()] }, { store });
		const { observed } = subscribed(kit);
		const settlement = settlementOf(kit.waitForAccount(accountId));
		await vi.advanceTimersByTimeAsync(10_000);
		const beforeAnswer = observed(settlement);
		for (const answer of answerAccounts.splice(0)) answer([ETH_ADDRESS]);
		await vi.advanceTimersByTimeAsync(100);

		expect({ beforeAnswer, afterAnswer: settlement() }).toEqual({
			beforeAnswer: {
				settlement: "pending",
				isHydrating: false,
				isConnected: true,
				accounts: 0,
			},
			afterAnswer: "resolved",
		});
	});
});

describe("createInstance", () => {
	const walletId = "polkadot:talisman" as const;
	let store: KheopskitStore;

	beforeEach(() => {
		store = createKheopskitStore({ storage: createMemoryStorage() });
	});

	afterEach(() => {
		store.destroy();
	});

	it("rejects ABORTED while nothing subscribes, and starts no run", async () => {
		const platformConnect = vi.fn(async () => {});
		const { runs, run$ } = runsOf(
			() => new BehaviorSubject(stateWith(walletId, platformConnect)),
		);
		const kit = createInstance(run$, store);
		const state = await firstValueFrom(kit.kheopskit$);

		const connect = settlementOf(
			state.wallets[0]?.connect() ?? Promise.resolve(),
		);
		await flushMicrotasks();

		expect({
			connect: connect(),
			runs: runs.length,
			observed: runs.map((run) => (run as Subject<unknown>).observed),
			platformConnectCalls: platformConnect.mock.calls.length,
		}).toEqual({
			connect: `rejected:ABORTED: [kheopskit] connect of wallet ${walletId} ${UNHELD}`,
			runs: 1,
			observed: [false],
			platformConnectCalls: 0,
		});
	});

	it("serves the run's latest state to a call made while held", async () => {
		const platformConnect = vi.fn(async () => {});
		const kit = createInstance(
			() => new BehaviorSubject(stateWith(walletId, platformConnect)),
			store,
		);
		let state: KheopskitState | undefined;
		const held = kit.kheopskit$.subscribe((next) => {
			state = next;
		});

		await state?.wallets[0]?.connect();
		held.unsubscribe();

		expect(platformConnect.mock.calls.length).toBe(1);
	});

	it("serves a subscriber that arrives in the caller's task", async () => {
		const platformConnect = vi.fn(async () => {});
		const kit = createInstance(
			() => new BehaviorSubject(stateWith(walletId, platformConnect)),
			store,
		);
		const state = await firstValueFrom(kit.kheopskit$);

		const connect = settlementOf(
			state.wallets[0]?.connect() ?? Promise.resolve(),
		);
		const held = kit.kheopskit$.subscribe();
		await flushMicrotasks();
		held.unsubscribe();

		expect({
			connect: connect(),
			platformConnectCalls: platformConnect.mock.calls.length,
		}).toEqual({ connect: "resolved", platformConnectCalls: 1 });
	});

	it.each([
		[
			"completes",
			(run: Subject<KheopskitState>) => run.complete(),
			"did not run because the pipeline completed",
		],
		[
			"errors",
			(run: Subject<KheopskitState>) => run.error(new Error("boom")),
			"did not run because the pipeline stopped with an error",
		],
	])(
		"rejects pending and later actions when the run %s, then restarts for the next subscriber",
		async (_, end, reason) => {
			const platformConnect = vi.fn(async () => {});
			const { runs, run$ } = runsOf(() => new Subject<KheopskitState>());
			const kit = createInstance(run$, store);
			const firstRun = kit.kheopskit$.subscribe({ error: () => {} });
			(runs[0] as Subject<KheopskitState>).next(
				stateWith(walletId, platformConnect),
			);
			const state = await firstValueFrom(kit.kheopskit$);
			firstRun.unsubscribe();
			const secondRun = kit.kheopskit$.subscribe({ error: () => {} });

			const pending = settlementOf(
				state.wallets[0]?.connect() ?? Promise.resolve(),
			);
			await flushMicrotasks();
			const beforeEnd = pending();
			end(runs[1] as Subject<KheopskitState>);
			await flushMicrotasks();
			const later = settlementOf(
				state.wallets[0]?.connect() ?? Promise.resolve(),
			);
			await flushMicrotasks();
			secondRun.unsubscribe();
			const thirdRun = kit.kheopskit$.subscribe();

			expect({
				beforeEnd,
				pending: pending(),
				later: later(),
				runs: runs.length,
				restarted: (runs[2] as Subject<KheopskitState> | undefined)?.observed,
				platformConnectCalls: platformConnect.mock.calls.length,
			}).toEqual({
				beforeEnd: "pending",
				pending: `rejected:ABORTED: [kheopskit] connect of wallet ${walletId} ${reason}`,
				later: `rejected:ABORTED: [kheopskit] connect of wallet ${walletId} ${reason}`,
				runs: 3,
				restarted: true,
				platformConnectCalls: 0,
			});
			thirdRun.unsubscribe();
		},
	);

	it("presents one raw state as one object to every subscriber", () => {
		const raw = stateWith(walletId, async () => {});
		const kit = createInstance(() => new BehaviorSubject(raw), store);
		const seen: KheopskitState[] = [];

		const first = kit.kheopskit$.subscribe((state) => seen.push(state));
		const second = kit.kheopskit$.subscribe((state) => seen.push(state));
		first.unsubscribe();
		second.unsubscribe();

		expect({
			count: seen.length,
			same: seen[0] === seen[1],
			presentedAgain: kheopskitInternals(kit).present(raw) === seen[0],
			raw: seen[0] === raw,
		}).toEqual({ count: 2, same: true, presentedAgain: true, raw: false });
	});

	it("keeps a wallet's object across emissions while the run keeps its raw wallet", () => {
		const first = stateWith(walletId, async () => {});
		const second = { ...first, isDiscovering: true } as KheopskitState;
		const states = new Subject<KheopskitState>();
		const kit = createInstance(() => states, store);
		const seen: KheopskitState[] = [];

		const subscription = kit.kheopskit$.subscribe((state) => seen.push(state));
		states.next(first);
		states.next(second);
		subscription.unsubscribe();

		expect({
			states: seen.length,
			sameWallet: seen[0]?.wallets[0] === seen[1]?.wallets[0],
		}).toEqual({ states: 2, sameWallet: true });
	});
});
