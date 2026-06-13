/// <reference types="@testing-library/jest-dom" />
import { ethereum } from "@kheopskit/core/ethereum";
import { polkadot } from "@kheopskit/core/polkadot";
import { render, screen } from "@testing-library/react";
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
