/// <reference types="@testing-library/jest-dom/vitest" />
import { createKheopskitStore, type KheopskitStore } from "@kheopskit/core";
import { ethereum } from "@kheopskit/core/ethereum";
import { polkadot } from "@kheopskit/core/polkadot";
import {
	createFakePolkadotExtension,
	createMemoryStorage,
	type FakePolkadotExtension,
} from "@kheopskit/core/testing";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKheopskit } from "./createKheopskit";

describe("createKheopskit", () => {
	beforeEach(() => {
		// resolveConfig warns when no platforms are configured; silence noise.
		vi.spyOn(console, "warn").mockImplementation(() => {});
		localStorage.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("provides hooks bound to the platform tuple", () => {
		const { KheopskitProvider, useWallets, useAccounts } = createKheopskit({
			platforms: [polkadot(), ethereum()],
			autoReconnect: false,
		});

		const Consumer = () => {
			const { wallets, config } = useWallets();
			const accounts = useAccounts();
			return (
				<div>
					<span data-testid="wallets">{wallets.length}</span>
					<span data-testid="accounts">{accounts.length}</span>
					<span data-testid="platforms">
						{config.platforms.map((p) => p.platform).join(",")}
					</span>
				</div>
			);
		};

		render(
			<KheopskitProvider>
				<Consumer />
			</KheopskitProvider>,
		);

		expect(screen.getByTestId("platforms")).toHaveTextContent(
			"polkadot,ethereum",
		);
		expect(
			Number(screen.getByTestId("wallets").textContent),
		).toBeGreaterThanOrEqual(0);
		expect(
			Number(screen.getByTestId("accounts").textContent),
		).toBeGreaterThanOrEqual(0);
	});

	it("throws when its hooks are used outside the provider", () => {
		const { useWallets } = createKheopskit({ platforms: [polkadot()] });
		const Orphan = () => {
			useWallets();
			return null;
		};
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() => render(<Orphan />)).toThrow(/KheopskitProvider/);
		errorSpy.mockRestore();
	});
});

describe("createKheopskit shared instance", () => {
	const alice = {
		address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
	};
	let fake: FakePolkadotExtension;
	let storage: ReturnType<typeof createMemoryStorage>;
	let store: KheopskitStore;

	beforeEach(() => {
		vi.useFakeTimers();
		fake = createFakePolkadotExtension({ name: "talisman" });
		storage = createMemoryStorage();
		store = createKheopskitStore({ storage });
		store.rememberWallet(fake.walletId);
	});

	afterEach(() => {
		fake.uninstall();
		store.destroy();
		vi.useRealTimers();
	});

	const createInstance = () => {
		const instance = createKheopskit({ platforms: [polkadot()] }, { store });
		const Statuses = () => (
			<span data-testid="statuses">
				{instance
					.useWallets()
					.wallets.map((wallet) => `${wallet.id}:${wallet.status}`)
					.join(",")}
			</span>
		);
		return { ...instance, Statuses };
	};

	it("provider and kheopskit$ share one pipeline", async () => {
		const { KheopskitProvider, kheopskit$, Statuses } = createInstance();

		render(
			<KheopskitProvider>
				<Statuses />
			</KheopskitProvider>,
		);
		const plainStatuses: string[] = [];
		const subscription = kheopskit$.subscribe((state) => {
			plainStatuses.push(
				state.wallets.map((wallet) => `${wallet.id}:${wallet.status}`).join(),
			);
		});
		await act(() => vi.advanceTimersByTimeAsync(1000));

		expect({
			enableCalls: fake.enableCalls().length,
			rendered: screen.getByTestId("statuses").textContent,
			plain: plainStatuses.at(-1),
		}).toEqual({
			enableCalls: 1,
			rendered: "polkadot:talisman:connected",
			plain: "polkadot:talisman:connected",
		});
		subscription.unsubscribe();
	});

	it("kheopskit$ completes its pipeline when the last subscriber leaves", async () => {
		const { KheopskitProvider, kheopskit$, Statuses } = createInstance();
		const writes = vi.spyOn(storage, "setItem");
		const writesAfterSetting = async (accounts: (typeof alice)[]) => {
			writes.mockClear();
			fake.setAccounts(accounts);
			await act(() => vi.advanceTimersByTimeAsync(0));
			const pendingTimers = vi.getTimerCount();
			await act(() => vi.advanceTimersByTimeAsync(5000));
			return { pendingTimers, writes: writes.mock.calls.length };
		};

		const { unmount } = render(
			<KheopskitProvider>
				<Statuses />
			</KheopskitProvider>,
		);
		const subscription = kheopskit$.subscribe(() => {});
		await act(() => vi.advanceTimersByTimeAsync(5000));
		const bothSubscribed = await writesAfterSetting([alice]);

		unmount();
		await Promise.resolve();
		const plainSubscribed = await writesAfterSetting([]);

		subscription.unsubscribe();
		store.destroy();
		const noSubscriber = await writesAfterSetting([alice]);

		expect({
			bothSubscribed,
			plainSubscribed,
			noSubscriber,
			timersLeft: vi.getTimerCount(),
		}).toEqual({
			bothSubscribed: { pendingTimers: 1, writes: 1 },
			plainSubscribed: { pendingTimers: 1, writes: 1 },
			noSubscriber: { pendingTimers: 0, writes: 0 },
			timersLeft: 0,
		});
	});
});
