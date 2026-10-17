/// <reference types="@testing-library/jest-dom/vitest" />
import { polkadot } from "@kheopskit/core/polkadot";
import { render, screen } from "@testing-library/react";
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

		expect(added.length).toBeGreaterThan(0);
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
});
