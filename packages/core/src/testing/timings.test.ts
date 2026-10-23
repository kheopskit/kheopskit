import {
	createKheopskit,
	createKheopskitStore,
	type KheopskitState,
	type KheopskitStore,
} from "@kheopskit/core";
import { polkadot } from "@kheopskit/core/polkadot";
import {
	cachedWalletOf,
	createFakePolkadotExtension,
	createMemoryStorage,
	DEFAULT_HYDRATION_TIMEOUT_MS,
	DISCOVERY_WINDOW_MS,
	type FakePolkadotExtension,
} from "@kheopskit/core/testing";
import type { Subscription } from "rxjs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let talisman: FakePolkadotExtension;
let store: KheopskitStore;
let subscription: Subscription;
let state: KheopskitState | undefined;

const start = () => {
	const { kheopskit$ } = createKheopskit(
		{ platforms: [polkadot()] },
		{ store },
	);
	subscription = kheopskit$.subscribe((next) => {
		state = next;
	});
};

beforeEach(() => {
	vi.useFakeTimers();
	talisman = createFakePolkadotExtension({ name: "talisman", enable: "hold" });
	store = createKheopskitStore({ storage: createMemoryStorage() });
});

afterEach(() => {
	talisman.uninstall();
	subscription.unsubscribe();
	store.destroy();
	vi.useRealTimers();
});

it("discovery ends DISCOVERY_WINDOW_MS after a loaded page subscribes", async () => {
	start();

	await vi.advanceTimersByTimeAsync(DISCOVERY_WINDOW_MS - 1);
	expect(state?.isDiscovering).toBe(true);
	await vi.advanceTimersByTimeAsync(1);
	expect(state?.isDiscovering).toBe(false);
});

it("a reconnect that never settles holds hydration for DEFAULT_HYDRATION_TIMEOUT_MS", async () => {
	store.rememberWallet(talisman.walletId);
	store.setCachedState([cachedWalletOf(talisman.walletId, "Talisman")], []);
	start();

	await vi.advanceTimersByTimeAsync(DEFAULT_HYDRATION_TIMEOUT_MS - 1);
	expect(state?.isHydrating).toBe(true);
	await vi.advanceTimersByTimeAsync(1);
	expect(state?.isHydrating).toBe(false);
});
