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
	type FakePolkadotExtension,
} from "@kheopskit/core/testing";
import type { Subscription } from "rxjs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const alice = {
	address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
	name: "Alice",
	type: "sr25519" as const,
};

let talisman: FakePolkadotExtension;
let store: KheopskitStore;
let subscription: Subscription;

beforeEach(() => {
	vi.useFakeTimers();
	talisman = createFakePolkadotExtension({
		name: "talisman",
		accounts: [alice],
	});
	store = createKheopskitStore({ storage: createMemoryStorage() });
});

afterEach(() => {
	talisman.uninstall();
	subscription.unsubscribe();
	store.destroy();
	expect(vi.getTimerCount()).toBe(0);
	vi.useRealTimers();
});

it("reconnects the wallet the user connected last time", async () => {
	const wallet = cachedWalletOf(talisman.walletId, "Talisman");
	store.rememberWallet(talisman.walletId);
	store.setCachedState(
		[wallet],
		[cachedAccountOf(wallet, alice.address, alice.name)],
	);

	const { kheopskit$ } = createKheopskit(
		{ platforms: [polkadot()] },
		{ store },
	);
	let state: KheopskitState | undefined;
	subscription = kheopskit$.subscribe((next) => {
		state = next;
	});
	await vi.advanceTimersByTimeAsync(1000);

	expect(talisman.enableCalls()).toHaveLength(1);
	expect(state?.wallets.map((w) => [w.id, w.isConnected])).toEqual([
		["polkadot:talisman", true],
	]);
	expect(state?.accounts.map((a) => a.name)).toEqual(["Alice"]);
});
