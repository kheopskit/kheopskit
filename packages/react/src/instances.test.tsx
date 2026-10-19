import { createKheopskitStore, type KheopskitStore } from "@kheopskit/core";
import { polkadot } from "@kheopskit/core/polkadot";
import {
	createFakePolkadotExtension,
	createMemoryStorage,
	type FakePolkadotExtension,
} from "@kheopskit/core/testing";
import { act, cleanup, render } from "@testing-library/react";
import type { Subscription } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKheopskit } from "./createKheopskit";
import { KheopskitProvider } from "./KheopskitProvider";

describe("pipelines per instance", () => {
	let fake: FakePolkadotExtension;
	const stores: KheopskitStore[] = [];
	let outside: Subscription | undefined;

	const rememberingStore = () => {
		const store = createKheopskitStore({ storage: createMemoryStorage() });
		store.rememberWallet(fake.walletId);
		stores.push(store);
		return store;
	};

	beforeEach(() => {
		vi.useFakeTimers();
		fake = createFakePolkadotExtension({
			name: "talisman",
			accounts: [
				{ address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" },
			],
		});
	});

	afterEach(() => {
		cleanup();
		outside?.unsubscribe();
		outside = undefined;
		for (const store of stores.splice(0)) store.destroy();
		fake.uninstall();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it("runs one pipeline per standalone KheopskitProvider mount", async () => {
		const plugin = polkadot();
		const walletSources = vi.spyOn(plugin, "getWallets$");
		const config = { platforms: [plugin] };
		render(
			<>
				<KheopskitProvider config={config} store={rememberingStore()} />
				<KheopskitProvider config={config} store={rememberingStore()} />
			</>,
		);
		await act(() => vi.advanceTimersByTimeAsync(1000));

		expect(walletSources).toHaveBeenCalledTimes(2);
	});

	it("runs one pipeline for a createKheopskit provider and an outside subscriber", async () => {
		const plugin = polkadot();
		const walletSources = vi.spyOn(plugin, "getWallets$");
		const { KheopskitProvider: Provider, kheopskit$ } = createKheopskit(
			{ platforms: [plugin] },
			{ store: rememberingStore() },
		);
		outside = kheopskit$.subscribe();
		render(<Provider />);
		await act(() => vi.advanceTimersByTimeAsync(1000));

		expect({
			walletSources: walletSources.mock.calls.length,
			enableCalls: fake.enableCalls().length,
		}).toEqual({ walletSources: 1, enableCalls: 1 });
	});
});
