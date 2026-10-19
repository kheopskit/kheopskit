// @vitest-environment node
import { firstValueFrom } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKheopskit } from "./instance";
import { polkadot } from "./polkadot/plugin";
import type { KheopskitState } from "./types";

describe("an ssr instance on the server", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("emits wallet-less states and leaves nothing running once unsubscribed", async () => {
		const kit = createKheopskit({ platforms: [polkadot()] }, { ssr: true });
		const states: KheopskitState[] = [];

		const subscription = kit.kheopskit$.subscribe((state) =>
			states.push(state),
		);
		await vi.advanceTimersByTimeAsync(0);
		subscription.unsubscribe();
		const timersAfterUnsubscribe = vi.getTimerCount();
		await vi.advanceTimersByTimeAsync(5000);

		expect({
			states: states.map(({ wallets, accounts }) => ({ wallets, accounts })),
			timersAfterUnsubscribe,
			persisted: await firstValueFrom(kit.store.observable),
		}).toEqual({
			states: [{ wallets: [], accounts: [] }],
			timersAfterUnsubscribe: 0,
			persisted: {},
		});
	});

	it("lets module code touch the store without throwing or writing", async () => {
		const { store } = createKheopskit(
			{ platforms: [polkadot()] },
			{ ssr: true },
		);

		store.rememberWallet("polkadot:talisman");
		store.forgetWallet("polkadot:subwallet-js");
		store.setCachedState([], []);

		expect({
			persisted: await firstValueFrom(store.observable),
			cached: store.getCachedState(),
		}).toEqual({ persisted: {}, cached: { wallets: [], accounts: [] } });
	});
});
