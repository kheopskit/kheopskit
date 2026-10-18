import type { Subscription } from "rxjs";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type MockInstance,
	vi,
} from "vitest";
import {
	createFakePolkadotExtension,
	createMemoryStorage,
	type FakePolkadotExtension,
} from "../../testing";
import { getKheopskit$ } from "../kheopskit";
import { createKheopskitStore, type KheopskitStore } from "../store";
import type { KheopskitState } from "../types";
import { polkadot } from "./plugin";

type Frame = {
	at: number;
	isDiscovering: boolean;
	isHydrating: boolean;
	wallets: string[];
	connected: string[];
};

const TALISMAN = "polkadot:talisman";

let frames: Frame[];
let store: KheopskitStore;
let subscription: Subscription | undefined;
let talisman: FakePolkadotExtension | undefined;
let readyState: MockInstance<() => DocumentReadyState>;

beforeEach(() => {
	vi.useFakeTimers();
	frames = [];
	store = createKheopskitStore({ storage: createMemoryStorage() });
	readyState = vi.spyOn(document, "readyState", "get");
});

afterEach(() => {
	subscription?.unsubscribe();
	subscription = undefined;
	talisman?.uninstall();
	talisman = undefined;
	store.destroy();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const subscribe = (
	documentReadyState: DocumentReadyState,
	config: { autoReconnect?: boolean } = { autoReconnect: false },
) => {
	readyState.mockReturnValue(documentReadyState);
	const start = Date.now();
	subscription = getKheopskit$(
		{ platforms: [polkadot()], hydrationGracePeriod: 0, ...config },
		{ store },
	).subscribe((state: KheopskitState) =>
		frames.push({
			at: Date.now() - start,
			isDiscovering: state.isDiscovering,
			isHydrating: state.isHydrating,
			wallets: state.wallets.map((w) => w.id),
			connected: state.wallets.filter((w) => w.isConnected).map((w) => w.id),
		}),
	);
};

const fireLoad = () => {
	readyState.mockReturnValue("complete");
	window.dispatchEvent(new Event("load"));
};

const injectTalisman = () => {
	talisman = createFakePolkadotExtension({ name: "talisman" });
};

const firstSettledFrame = () => frames.find((f) => !f.isDiscovering);

describe("isDiscovering turns false only once no scheduled registry read remains", () => {
	it("subscribed before load, injected 50 ms after load", async () => {
		subscribe("interactive");
		await vi.advanceTimersByTimeAsync(1_500);
		fireLoad();
		await vi.advanceTimersByTimeAsync(50);
		injectTalisman();
		await vi.advanceTimersByTimeAsync(2_000);

		expect(frames.at(-1)?.wallets).toEqual([TALISMAN]);
		expect(firstSettledFrame()).toMatchObject({ wallets: [TALISMAN] });
	});

	it("subscribed after load, injected 50 ms after subscribe", async () => {
		subscribe("complete");
		await vi.advanceTimersByTimeAsync(50);
		injectTalisman();
		await vi.advanceTimersByTimeAsync(2_000);

		expect(frames.at(-1)?.wallets).toEqual([TALISMAN]);
		expect(firstSettledFrame()).toMatchObject({ wallets: [TALISMAN] });
	});

	it("subscribed before load, injected just before the load + 1100 ms read", async () => {
		subscribe("interactive");
		await vi.advanceTimersByTimeAsync(1_500);
		fireLoad();
		await vi.advanceTimersByTimeAsync(1_099);
		injectTalisman();
		await vi.advanceTimersByTimeAsync(1_000);

		expect(firstSettledFrame()).toMatchObject({
			at: 2_600,
			wallets: [TALISMAN],
		});
	});
});

describe("the registry is read until 1100 ms after load or subscribe, whichever is later", () => {
	it("subscribed at 0, load at 1500 ms, injected at 1700 ms", async () => {
		subscribe("interactive");
		await vi.advanceTimersByTimeAsync(1_500);
		fireLoad();
		await vi.advanceTimersByTimeAsync(200);
		injectTalisman();
		await vi.advanceTimersByTimeAsync(5_000);

		expect(frames.at(-1)?.wallets).toEqual([TALISMAN]);
	});

	it("subscribed after load, a wallet injected after the 1100 ms read is not listed", async () => {
		subscribe("complete");
		await vi.advanceTimersByTimeAsync(1_100);
		injectTalisman();
		await vi.advanceTimersByTimeAsync(5_000);

		expect(frames.at(-1)).toMatchObject({
			at: 1_100,
			isDiscovering: false,
			wallets: [],
		});
		expect(frames.filter((f) => f.at < 1_100).length).toBeGreaterThan(0);
		expect(
			frames.map((f) => ({ at: f.at, isDiscovering: f.isDiscovering })),
		).toEqual(frames.map((f) => ({ at: f.at, isDiscovering: f.at < 1_100 })));
	});

	it("a remembered wallet injected at 1700 ms reconnects", async () => {
		store.rememberWallet(TALISMAN);
		subscribe("interactive", { autoReconnect: true });
		await vi.advanceTimersByTimeAsync(1_500);
		fireLoad();
		await vi.advanceTimersByTimeAsync(200);
		injectTalisman();
		await vi.advanceTimersByTimeAsync(5_000);

		expect(talisman?.enableCalls()).toHaveLength(1);
		expect(frames.at(-1)?.connected).toEqual([TALISMAN]);
	});
});
