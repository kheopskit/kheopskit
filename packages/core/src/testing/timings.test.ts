import {
	createKheopskit,
	createKheopskitStore,
	type KheopskitState,
	type KheopskitStore,
} from "@kheopskit/core";
import { polkadot } from "@kheopskit/core/polkadot";
import {
	cachedAccountOf,
	cachedWalletOf,
	createFakePolkadotExtension,
	createMemoryStorage,
	DEFAULT_HYDRATION_GRACE_PERIOD_MS,
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

const alice = {
	address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
	name: "Alice",
	type: "sr25519" as const,
};

const install = (enable: "resolve" | "hold") => {
	talisman = createFakePolkadotExtension({
		name: "talisman",
		accounts: [alice],
		enable,
	});
	const wallet = cachedWalletOf(talisman.walletId, "Talisman");
	store.rememberWallet(talisman.walletId);
	store.setCachedState(
		[wallet],
		[cachedAccountOf(wallet, alice.address, alice.name)],
	);
};

beforeEach(() => {
	vi.useFakeTimers();
	store = createKheopskitStore({ storage: createMemoryStorage() });
});

afterEach(() => {
	talisman.uninstall();
	subscription.unsubscribe();
	store.destroy();
	vi.useRealTimers();
});

it("discovery ends DISCOVERY_WINDOW_MS after a loaded page subscribes", async () => {
	install("hold");
	start();

	await vi.advanceTimersByTimeAsync(DISCOVERY_WINDOW_MS - 1);
	expect(state?.isDiscovering).toBe(true);
	await vi.advanceTimersByTimeAsync(1);
	expect(state?.isDiscovering).toBe(false);
});

it("a reconnect that never settles holds hydration for DEFAULT_HYDRATION_TIMEOUT_MS", async () => {
	install("hold");
	start();

	await vi.advanceTimersByTimeAsync(DEFAULT_HYDRATION_TIMEOUT_MS - 1);
	expect(state?.isHydrating).toBe(true);
	await vi.advanceTimersByTimeAsync(1);
	expect(state?.isHydrating).toBe(false);
});

it("a reconnect that settles at once ends hydration at DEFAULT_HYDRATION_GRACE_PERIOD_MS", async () => {
	install("resolve");
	start();

	await vi.advanceTimersByTimeAsync(DEFAULT_HYDRATION_GRACE_PERIOD_MS - 1);
	expect(state?.isHydrating).toBe(true);
	await vi.advanceTimersByTimeAsync(1);
	expect(state?.isHydrating).toBe(false);
});
