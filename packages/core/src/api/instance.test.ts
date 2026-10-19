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
	cachedWalletOf,
	createFakePolkadotExtension,
	createMemoryStorage,
	type FakePolkadotExtension,
} from "../testing";
import type { WalletId } from "../utils/WalletId";
import type { KheopskitError } from "./errors";
import {
	createInstance,
	createKheopskit,
	kheopskitInternals,
} from "./instance";
import { polkadot } from "./polkadot/plugin";
import { createKheopskitStore } from "./store";
import type { KheopskitState, KheopskitStore } from "./types";

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
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
});
