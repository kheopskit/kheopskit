/// <reference types="@testing-library/jest-dom" />
import { ethereum } from "@kheopskit/core/ethereum";
import { polkadot } from "@kheopskit/core/polkadot";
import { solana } from "@kheopskit/core/solana";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Replace the live kheopskit observable with one that NEVER emits synchronously.
// This reproduces a real SPA reload where the first emission is deferred (e.g.
// WalletConnect's AppKit is loaded via dynamic import, so the underlying
// combineLatest can't emit on the first frame). With no synchronous emission,
// the provider's first paint comes entirely from its initial snapshot — which is
// exactly what must reflect the client cache to avoid the empty-list flash.
vi.mock("@kheopskit/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@kheopskit/core")>();
	const { NEVER } = await import("rxjs");
	return {
		...actual,
		getKheopskit$: () => NEVER,
	};
});

import { KheopskitProvider } from "./KheopskitProvider";
import { useWallets } from "./useWallets";

const STORAGE_KEY = "kheopskit";

const WalletsConsumer = () => {
	const { wallets, accounts } = useWallets();
	return (
		<div>
			<span data-testid="wallets-count">{wallets.length}</span>
			<span data-testid="accounts-count">{accounts.length}</span>
			<span data-testid="wallet-names">
				{wallets.map((w) => w.name).join(",")}
			</span>
			<span data-testid="account-order">
				{accounts.map((a) => `${a.platform}:${a.walletName}`).join(",")}
			</span>
		</div>
	);
};

describe("KheopskitProvider hydration (no flash on SPA reload)", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("paints cached wallets on the first client render, before the live observable emits (no ssrCookies)", () => {
		// Simulate a prior session persisted to localStorage (SPA uses localStorage,
		// not cookies — there is no ssrCookies in a client-only app).
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				cachedWallets: [
					{
						id: "polkadot:talisman",
						platform: "polkadot",
						type: "injected",
						name: "Talisman",
						isConnected: false,
					},
					{
						id: "polkadot:subwallet-js",
						platform: "polkadot",
						type: "injected",
						name: "SubWallet",
						isConnected: false,
					},
				],
				cachedAccounts: [],
			}),
		);

		render(
			<KheopskitProvider config={{ platforms: [polkadot()] }}>
				<WalletsConsumer />
			</KheopskitProvider>,
		);

		// Regression guard: before the fix this was "0" — the SPA path ignored the
		// client cache for the initial snapshot and flashed an empty wallet list
		// until the (asynchronous) observable emitted.
		expect(screen.getByTestId("wallets-count")).toHaveTextContent("2");
		expect(screen.getByTestId("wallet-names")).toHaveTextContent(
			"Talisman,SubWallet",
		);
	});

	it("paints cached connected accounts on the first client render (no ssrCookies)", () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				cachedWallets: [
					{
						id: "polkadot:talisman",
						platform: "polkadot",
						type: "injected",
						name: "Talisman",
						isConnected: true,
					},
				],
				cachedAccounts: [
					{
						id: "polkadot:talisman:5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
						platform: "polkadot",
						address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
						polkadotAccountType: "sr25519",
						walletId: "polkadot:talisman",
						walletName: "Talisman",
					},
				],
			}),
		);

		render(
			<KheopskitProvider config={{ platforms: [polkadot()] }}>
				<WalletsConsumer />
			</KheopskitProvider>,
		);

		expect(screen.getByTestId("wallets-count")).toHaveTextContent("1");
		expect(screen.getByTestId("accounts-count")).toHaveTextContent("1");
	});

	it("renders an empty list on a fresh visit with no cache (no flash to fill)", () => {
		render(
			<KheopskitProvider config={{ platforms: [polkadot()] }}>
				<WalletsConsumer />
			</KheopskitProvider>,
		);

		expect(screen.getByTestId("wallets-count")).toHaveTextContent("0");
		expect(screen.getByTestId("accounts-count")).toHaveTextContent("0");
	});

	it("paints cached accounts in sorted order, regardless of how they were stored", () => {
		// Stored out of order (solana, ethereum, polkadot). The first paint must
		// already be in the canonical sortAccounts order so the list does not
		// reorder once the live observable emits (which is also sorted).
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				cachedWallets: [],
				cachedAccounts: [
					{
						id: "solana:mock:So11111111111111111111111111111111111111112",
						platform: "solana",
						address: "So11111111111111111111111111111111111111112",
						walletId: "solana:mock",
						walletName: "Zeta",
					},
					{
						id: "ethereum:mock:0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
						platform: "ethereum",
						address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
						chainId: 1,
						walletId: "ethereum:mock",
						walletName: "Beta",
					},
					{
						id: "polkadot:talisman:5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
						platform: "polkadot",
						address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
						polkadotAccountType: "sr25519",
						walletId: "polkadot:talisman",
						walletName: "Talisman",
					},
				],
			}),
		);

		render(
			<KheopskitProvider
				config={{ platforms: [polkadot(), ethereum(), solana()] }}
			>
				<WalletsConsumer />
			</KheopskitProvider>,
		);

		// Canonical order: polkadot, then ethereum, then solana.
		expect(screen.getByTestId("account-order")).toHaveTextContent(
			"polkadot:Talisman,ethereum:Beta,solana:Zeta",
		);
	});

	it("renders empty (no crash) when localStorage holds malformed/legacy cache", () => {
		// Cache written by an older or incompatible version: wrong wallet id shape
		// and accounts missing required fields. The provider must degrade to an
		// empty list, not throw during render and blank the dapp.
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				cachedWallets: [
					{ id: "garbage", name: "X" },
					{ id: "polkadot:talisman", platform: "polkadot" }, // missing fields
				],
				cachedAccounts: [{ foo: "bar" }],
			}),
		);

		expect(() =>
			render(
				<KheopskitProvider config={{ platforms: [polkadot()] }}>
					<WalletsConsumer />
				</KheopskitProvider>,
			),
		).not.toThrow();

		expect(screen.getByTestId("wallets-count")).toHaveTextContent("0");
		expect(screen.getByTestId("accounts-count")).toHaveTextContent("0");
	});
});
