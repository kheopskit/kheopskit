// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../../testing";
import { resolveConfig } from "../config";
import { kheopskitRun$ } from "../kheopskit";
import { createKheopskitStore } from "../store";
import type { KheopskitState } from "../types";
import { polkadot } from "./plugin";

describe("polkadot discovery on the server", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const memoryStore = () =>
		createKheopskitStore({ storage: createMemoryStorage() });

	it("the polkadot wallets stream sets no timer", () => {
		const plugin = polkadot();
		const wallets: string[][] = [];
		const subscription = plugin
			.getWallets$({
				store: memoryStore(),
				config: resolveConfig({ platforms: [plugin] }),
			})
			.subscribe((list) => wallets.push(list.map((w) => w.id)));

		expect(wallets).toEqual([[]]);
		expect(vi.getTimerCount()).toBe(0);
		subscription.unsubscribe();
	});

	it("kheopskit$ holds only the cache write debounce and stays discovering", async () => {
		const states: KheopskitState[] = [];
		const subscription = kheopskitRun$(
			{ platforms: [polkadot()], hydrationGracePeriod: 0 },
			{ store: memoryStore() },
		).subscribe((state) => states.push(state));
		await vi.advanceTimersByTimeAsync(0);
		expect(vi.getTimerCount()).toBe(1);

		await vi.advanceTimersByTimeAsync(1000);

		expect(vi.getTimerCount()).toBe(0);
		expect(states.at(-1)).toMatchObject({ wallets: [], isDiscovering: true });
		subscription.unsubscribe();
	});
});
