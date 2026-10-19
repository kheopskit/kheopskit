import { firstValueFrom, type Subscription } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	cachedWalletOf,
	createFakePolkadotExtension,
	createMemoryStorage,
	type FakePolkadotExtension,
} from "../../testing";
import { getKheopskit$ } from "../kheopskit";
import { createKheopskitStore, type KheopskitStore } from "../store";
import type { KheopskitState } from "../types";
import { polkadot } from "./plugin";

const TALISMAN = "polkadot:talisman";

let store: KheopskitStore;
let subscription: Subscription | undefined;
let talisman: FakePolkadotExtension | undefined;
let latest: KheopskitState | undefined;

beforeEach(() => {
	vi.useFakeTimers();
	store = createKheopskitStore({ storage: createMemoryStorage() });
	vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
	store.rememberWallet(TALISMAN);
	store.setCachedState([cachedWalletOf(TALISMAN, "Talisman")], []);
});

afterEach(() => {
	subscription?.unsubscribe();
	subscription = undefined;
	talisman?.uninstall();
	talisman = undefined;
	latest = undefined;
	store.destroy();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const subscribe = () => {
	subscription = getKheopskit$(
		{ platforms: [polkadot()] },
		{ store },
	).subscribe((state) => {
		latest = state;
	});
};

const rememberedIds = async () =>
	(await firstValueFrom(store.observable)).remembered ?? [];

const talismanIn = (state: KheopskitState | undefined) =>
	state?.wallets.find((w) => w.id === TALISMAN);

describe("a remembered wallet that has not injected yet", () => {
	it.each([
		["its placeholder's disconnect()", () => talismanIn(latest)?.disconnect()],
		["store.forgetWallet()", () => store.forgetWallet(TALISMAN)],
	])("is not reconnected after %s", async (_, forget) => {
		subscribe();
		await vi.advanceTimersByTimeAsync(10);
		expect(talismanIn(latest)).toMatchObject({
			isPlaceholder: true,
			status: "connecting",
		});

		await forget();
		talisman = createFakePolkadotExtension({ name: "talisman" });
		await vi.advanceTimersByTimeAsync(5_000);

		expect(talisman.enableCalls()).toEqual([]);
		expect(talismanIn(latest)?.status).toBe("disconnected");
		expect(await rememberedIds()).toEqual([]);
	});

	it("keeps the remembered list when its placeholder's disconnect() runs after the subscription ended", async () => {
		subscribe();
		await vi.advanceTimersByTimeAsync(10);
		const placeholder = talismanIn(latest);
		subscription?.unsubscribe();

		await placeholder?.disconnect();

		expect(await rememberedIds()).toEqual([TALISMAN]);
	});

	it("is not reconnected when it is remembered again after a forget", async () => {
		subscribe();
		await vi.advanceTimersByTimeAsync(10);

		store.forgetWallet(TALISMAN);
		store.rememberWallet(TALISMAN);
		talisman = createFakePolkadotExtension({ name: "talisman" });
		await vi.advanceTimersByTimeAsync(5_000);

		expect(talisman.enableCalls()).toEqual([]);
	});
});

it("a placeholder's disconnect() called after discovery aborts the pending reconnect", async () => {
	subscribe();
	await vi.advanceTimersByTimeAsync(10);
	const placeholder = talismanIn(latest);
	talisman = createFakePolkadotExtension({ name: "talisman", enable: "hold" });
	await vi.advanceTimersByTimeAsync(200);
	expect(talisman.enableCalls()).toHaveLength(1);

	await placeholder?.disconnect();
	talisman.resolveEnable();
	await vi.advanceTimersByTimeAsync(10);

	expect(talismanIn(latest)?.status).toBe("disconnected");
});

it("forgetting another remembered wallet does not retry a failed reconnect", async () => {
	store.rememberWallet("polkadot:polkadot-js");
	talisman = createFakePolkadotExtension({ name: "talisman", enable: "hold" });
	subscribe();
	await vi.advanceTimersByTimeAsync(10);
	talisman.rejectEnable(new Error("Extension crashed"));
	await vi.advanceTimersByTimeAsync(10);
	const attempts = talisman.enableCalls().length;

	store.forgetWallet("polkadot:polkadot-js");
	await vi.advanceTimersByTimeAsync(10);

	expect(talisman.enableCalls()).toHaveLength(attempts);
});

it("a remembered wallet disconnected after its reconnect was granted ends hydration at the grace period", async () => {
	talisman = createFakePolkadotExtension({ name: "talisman" });
	subscribe();
	await vi.advanceTimersByTimeAsync(10);

	await talismanIn(latest)?.disconnect();
	await vi.advanceTimersByTimeAsync(600);

	expect(latest?.isHydrating).toBe(false);
});

it("a disconnect() while the reconnect waits for the extension forgets the wallet and ends hydration at the grace period", async () => {
	talisman = createFakePolkadotExtension({ name: "talisman", enable: "hold" });
	subscribe();
	await vi.advanceTimersByTimeAsync(10);
	expect(talismanIn(latest)?.status).toBe("connecting");

	await talismanIn(latest)?.disconnect();
	talisman.resolveEnable();
	await vi.advanceTimersByTimeAsync(600);

	expect(talismanIn(latest)?.status).toBe("disconnected");
	expect(await rememberedIds()).toEqual([]);
	expect(latest?.isHydrating).toBe(false);
});

it("a disconnect() after a failed reconnect forgets the wallet", async () => {
	talisman = createFakePolkadotExtension({ name: "talisman", enable: "hold" });
	subscribe();
	await vi.advanceTimersByTimeAsync(10);
	talisman.rejectEnable(new Error("Extension crashed"));
	await vi.advanceTimersByTimeAsync(10);
	expect(talismanIn(latest)).toMatchObject({
		status: "disconnected",
		error: { code: "CONNECT_FAILED" },
	});

	await talismanIn(latest)?.disconnect();

	expect(await rememberedIds()).toEqual([]);
});
