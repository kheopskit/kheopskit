/// <reference types="@testing-library/jest-dom/vitest" />
import { createKheopskitStore } from "@kheopskit/core";
import { polkadot } from "@kheopskit/core/polkadot";
import {
	createFakePolkadotExtension,
	createMemoryStorage,
} from "@kheopskit/core/testing";
import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KheopskitProvider } from "./KheopskitProvider";
import { useWallets } from "./useWallets";

const config = { platforms: [polkadot()] };

const WalletNames = () => {
	const { wallets } = useWallets();
	return (
		<span data-testid="wallet-names">
			{wallets.map((w) => w.name).join(",")}
		</span>
	);
};

const spyStorageListeners = () => {
	const added: EventListenerOrEventListenerObject[] = [];
	const removed: EventListenerOrEventListenerObject[] = [];
	const addEventListener = window.addEventListener.bind(window);
	const removeEventListener = window.removeEventListener.bind(window);
	vi.spyOn(window, "addEventListener").mockImplementation(
		(type, listener, options) => {
			if (type === "storage" && listener) added.push(listener);
			addEventListener(type, listener, options);
		},
	);
	vi.spyOn(window, "removeEventListener").mockImplementation(
		(type, listener, options) => {
			if (type === "storage" && listener) removed.push(listener);
			removeEventListener(type, listener, options);
		},
	);
	return { added, removed };
};

describe("KheopskitProvider lifecycle", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("releases every storage listener on unmount", () => {
		const { added, removed } = spyStorageListeners();

		const { unmount } = render(
			<KheopskitProvider config={config}>
				<WalletNames />
			</KheopskitProvider>,
		);
		unmount();

		expect(added).toHaveLength(1);
		expect(removed).toEqual(added);
	});

	it("renders the persisted state after a StrictMode double mount", () => {
		localStorage.setItem(
			"kheopskit",
			JSON.stringify({
				cachedWallets: [
					{
						id: "polkadot:talisman",
						platform: "polkadot",
						type: "injected",
						name: "Talisman",
						isConnected: false,
					},
				],
				cachedAccounts: [],
			}),
		);

		render(
			<StrictMode>
				<KheopskitProvider config={config}>
					<WalletNames />
				</KheopskitProvider>
			</StrictMode>,
		);

		expect(screen.getByTestId("wallet-names")).toHaveTextContent("Talisman");
	});

	it("stops the pipeline when it unmounts", async () => {
		vi.useFakeTimers();
		const fake = createFakePolkadotExtension({ name: "talisman" });
		const storage = createMemoryStorage();
		const store = createKheopskitStore({ storage });
		store.rememberWallet(fake.walletId);
		const writes = vi.spyOn(storage, "setItem");
		const alice = {
			address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
		};

		const { unmount } = render(
			<KheopskitProvider config={config} store={store}>
				<WalletNames />
			</KheopskitProvider>,
		);
		await act(() => vi.advanceTimersByTimeAsync(1000));
		writes.mockClear();
		fake.setAccounts([alice]);
		await act(() => vi.advanceTimersByTimeAsync(5000));
		const writesWhileMounted = writes.mock.calls.length;

		unmount();
		await Promise.resolve();
		store.destroy();
		writes.mockClear();
		fake.setAccounts([]);
		await vi.advanceTimersByTimeAsync(5000);

		expect({
			writesWhileMounted,
			writesAfterUnmount: writes.mock.calls.length,
			timersAfterUnmount: vi.getTimerCount(),
		}).toEqual({
			writesWhileMounted: 1,
			writesAfterUnmount: 0,
			timersAfterUnmount: 0,
		});
		fake.uninstall();
		vi.useRealTimers();
	});
});
