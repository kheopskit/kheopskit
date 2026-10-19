/// <reference types="@testing-library/jest-dom/vitest" />
import {
	type CachedAccount,
	type CachedWallet,
	createKheopskitStore,
} from "@kheopskit/core";
import { ethereum } from "@kheopskit/core/ethereum";
import { polkadot } from "@kheopskit/core/polkadot";
import { solana } from "@kheopskit/core/solana";
import { cachedAccountOf, cachedWalletOf } from "@kheopskit/core/testing";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const liveObservable = vi.hoisted(() => ({ enabled: false }));

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
		getKheopskit$: (...args: Parameters<typeof actual.getKheopskit$>) =>
			liveObservable.enabled ? actual.getKheopskit$(...args) : NEVER,
	};
});

import { KheopskitProvider } from "./KheopskitProvider";
import { useWallets } from "./useWallets";

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const BOB = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
const HARDHAT_0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const seedCache = (wallets: CachedWallet[], accounts: CachedAccount[]) => {
	const store = createKheopskitStore();
	store.setCachedState(wallets, accounts);
	store.destroy();
};

const WalletsConsumer = () => {
	const { wallets, accounts, isHydrating } = useWallets();
	return (
		<div>
			<span data-testid="wallets-count">{wallets.length}</span>
			<span data-testid="accounts-count">{accounts.length}</span>
			<span data-testid="wallet-names">
				{wallets.map((w) => w.name).join(",")}
			</span>
			<span data-testid="wallet-status">
				{wallets.map((w) => `${w.id}:${w.status}:${w.isConnected}`).join(",")}
			</span>
			<span data-testid="account-order">
				{accounts.map((a) => `${a.platform}:${a.walletName}`).join(",")}
			</span>
			<span data-testid="placeholders">
				{`${wallets.length + accounts.length}:${[...wallets, ...accounts].every((i) => i.isPlaceholder)}`}
			</span>
			<span data-testid="is-hydrating">{String(isHydrating)}</span>
			<span data-testid="account-chainids">
				{accounts
					.map((a) => (a as { chainId?: number }).chainId ?? "-")
					.join(",")}
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
		seedCache(
			[
				{
					...cachedWalletOf("polkadot:talisman", "Talisman"),
					isConnected: false,
				},
				{
					...cachedWalletOf("polkadot:subwallet-js", "SubWallet"),
					isConnected: false,
				},
			],
			[],
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
		const talisman = cachedWalletOf("polkadot:talisman", "Talisman");
		seedCache(
			[talisman],
			[{ ...cachedAccountOf(talisman, ALICE), polkadotAccountType: "sr25519" }],
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
		const zeta = cachedWalletOf("solana:mock", "Zeta");
		const beta = cachedWalletOf("ethereum:mock", "Beta");
		const talisman = cachedWalletOf("polkadot:talisman", "Talisman");
		seedCache(
			[zeta, beta, talisman],
			[
				cachedAccountOf(zeta, "So11111111111111111111111111111111111111112"),
				{ ...cachedAccountOf(beta, HARDHAT_0), chainId: 1 },
				{ ...cachedAccountOf(talisman, ALICE), polkadotAccountType: "sr25519" },
			],
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

	it("remembers the ethereum chainId on the first render after reload", () => {
		const metamask = cachedWalletOf("ethereum:metamask", "MetaMask");
		seedCache(
			[metamask],
			[{ ...cachedAccountOf(metamask, HARDHAT_0), chainId: 137 }],
		);

		render(
			<KheopskitProvider config={{ platforms: [ethereum()] }}>
				<WalletsConsumer />
			</KheopskitProvider>,
		);

		// Regression: before the fix the placeholder dropped chainId, so this showed
		// "-" until the async live account loaded (flicker), instead of "137".
		expect(screen.getByTestId("account-chainids")).toHaveTextContent("137");
	});

	it("renders empty (no crash) when localStorage holds malformed/legacy cache", () => {
		// Cache written by an older or incompatible version: wrong wallet id shape
		// and accounts missing required fields. The provider must degrade to an
		// empty list, not throw during render and blank the dapp.
		localStorage.setItem(
			"kheopskit",
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

const DiscoveringConsumer = () => {
	const { isDiscovering } = useWallets();
	return <span data-testid="is-discovering">{String(isDiscovering)}</span>;
};

describe.each([
	["without ssrCookies", undefined],
	["with ssrCookies", "kheopskit={}"],
])("KheopskitProvider discovery snapshots %s", (_, ssrCookies) => {
	const tree = (
		<KheopskitProvider
			config={{ platforms: [polkadot()] }}
			ssrCookies={ssrCookies}
		>
			<DiscoveringConsumer />
		</KheopskitProvider>
	);

	it("reports isDiscovering on the server snapshot", () => {
		expect(renderToString(tree)).toContain(
			'<span data-testid="is-discovering">true</span>',
		);
	});

	it("reports isDiscovering on the client initial snapshot", () => {
		render(tree);
		expect(screen.getByTestId("is-discovering")).toHaveTextContent("true");
	});
});

describe("KheopskitProvider snapshots under an autoReconnect predicate", () => {
	const talisman = cachedWalletOf("polkadot:talisman", "Talisman");
	const subwallet = cachedWalletOf("polkadot:subwallet-js", "SubWallet");
	const cachedState = {
		cachedWallets: [talisman, subwallet],
		cachedAccounts: [
			{
				...cachedAccountOf(talisman, ALICE),
				polkadotAccountType: "sr25519" as const,
			},
			{
				...cachedAccountOf(subwallet, BOB),
				polkadotAccountType: "sr25519" as const,
			},
		],
	};
	const config = {
		platforms: [polkadot()],
		autoReconnect: (wallet: { id: string }) =>
			wallet.id === "polkadot:talisman",
	};
	const expectedStatuses =
		"polkadot:talisman:connecting:false,polkadot:subwallet-js:disconnected:false";
	const expectedAccounts = "polkadot:Talisman";

	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		// biome-ignore lint/suspicious/noDocumentCookie: necessary for test cleanup
		document.cookie = "kheopskit=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
	});

	it("server and client snapshots agree with ssrCookies", () => {
		const ssrCookies = `kheopskit=${encodeURIComponent(JSON.stringify(cachedState))}`;
		// biome-ignore lint/suspicious/noDocumentCookie: necessary for test setup
		document.cookie = ssrCookies;
		const tree = (
			<KheopskitProvider config={config} ssrCookies={ssrCookies}>
				<WalletsConsumer />
			</KheopskitProvider>
		);

		const html = renderToString(tree);
		expect(html).toContain(
			`data-testid="wallet-status">${expectedStatuses}</span>`,
		);
		expect(html).toContain(
			`data-testid="account-order">${expectedAccounts}</span>`,
		);

		render(tree);
		expect(screen.getByTestId("wallet-status")).toHaveTextContent(
			expectedStatuses,
		);
		expect(screen.getByTestId("account-order")).toHaveTextContent(
			expectedAccounts,
		);
	});

	it("the server snapshot and the client initial snapshot hold only placeholders", () => {
		const ssrCookies = `kheopskit=${encodeURIComponent(JSON.stringify(cachedState))}`;
		// biome-ignore lint/suspicious/noDocumentCookie: necessary for test setup
		document.cookie = ssrCookies;
		seedCache(cachedState.cachedWallets, cachedState.cachedAccounts);
		const withCookies = (
			<KheopskitProvider config={config} ssrCookies={ssrCookies}>
				<WalletsConsumer />
			</KheopskitProvider>
		);

		expect(renderToString(withCookies)).toContain(
			`data-testid="placeholders">3:true</span>`,
		);

		render(
			<KheopskitProvider config={config}>
				<WalletsConsumer />
			</KheopskitProvider>,
		);
		expect(screen.getByTestId("placeholders")).toHaveTextContent("3:true");
	});

	it("hydrating the server markup on the client raises no hydration warning and keeps the connecting status", async () => {
		const ssrCookies = `kheopskit=${encodeURIComponent(JSON.stringify(cachedState))}`;
		// biome-ignore lint/suspicious/noDocumentCookie: necessary for test setup
		document.cookie = ssrCookies;
		const tree = (
			<KheopskitProvider config={config} ssrCookies={ssrCookies}>
				<WalletsConsumer />
			</KheopskitProvider>
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const recoverable: unknown[] = [];
		const container = document.createElement("div");
		container.innerHTML = renderToString(tree);
		document.body.appendChild(container);
		const textOf = (testId: string) =>
			container.querySelector(`[data-testid="${testId}"]`)?.textContent;
		expect(textOf("wallet-status")).toBe(expectedStatuses);

		let root: Root | undefined;
		await act(async () => {
			root = hydrateRoot(container, tree, {
				onRecoverableError: (error) => recoverable.push(error),
			});
		});

		expect(textOf("wallet-status")).toBe(expectedStatuses);
		expect(textOf("account-order")).toBe(expectedAccounts);
		expect(recoverable).toEqual([]);
		expect(consoleError).not.toHaveBeenCalled();

		await act(async () => root?.unmount());
		container.remove();
	});

	it("without ssrCookies, hydrating the empty server markup raises no warning and then shows the client cache under the predicate", async () => {
		seedCache(cachedState.cachedWallets, cachedState.cachedAccounts);
		const tree = (
			<KheopskitProvider config={config}>
				<WalletsConsumer />
			</KheopskitProvider>
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const recoverable: unknown[] = [];
		const container = document.createElement("div");
		container.innerHTML = renderToString(tree);
		document.body.appendChild(container);
		const textOf = (testId: string) =>
			container.querySelector(`[data-testid="${testId}"]`)?.textContent;
		const server = {
			status: textOf("wallet-status"),
			accounts: textOf("account-order"),
		};

		let root: Root | undefined;
		await act(async () => {
			root = hydrateRoot(container, tree, {
				onRecoverableError: (error) => recoverable.push(error),
			});
		});

		expect({
			server,
			client: {
				status: textOf("wallet-status"),
				accounts: textOf("account-order"),
			},
			recoverable,
			consoleErrors: consoleError.mock.calls,
		}).toEqual({
			server: { status: "", accounts: "" },
			client: { status: expectedStatuses, accounts: expectedAccounts },
			recoverable: [],
			consoleErrors: [],
		});

		await act(async () => root?.unmount());
		container.remove();
	});
});

describe("KheopskitProvider hydration end", () => {
	beforeEach(() => {
		localStorage.clear();
		liveObservable.enabled = true;
		vi.useFakeTimers();
	});

	afterEach(() => {
		liveObservable.enabled = false;
		vi.useRealTimers();
	});

	it("isHydrating ends without a reconnect when autoReconnect is false, once discovery ends with the wallet absent", async () => {
		const store = createKheopskitStore();
		const talisman = cachedWalletOf("polkadot:talisman", "Talisman");
		store.rememberWallet(talisman.id);
		store.setCachedState(
			[talisman],
			[{ ...cachedAccountOf(talisman, ALICE), polkadotAccountType: "sr25519" }],
		);
		store.destroy();
		const config = {
			platforms: [polkadot()],
			autoReconnect: false,
			hydrationGracePeriod: 500,
		};
		render(
			<KheopskitProvider config={config}>
				<WalletsConsumer />
			</KheopskitProvider>,
		);

		await act(() => vi.advanceTimersByTimeAsync(1099));
		expect(screen.getByTestId("is-hydrating")).toHaveTextContent("true");
		expect(screen.getByTestId("wallet-status")).toHaveTextContent(
			"polkadot:talisman:disconnected:false",
		);

		await act(() => vi.advanceTimersByTimeAsync(1));
		expect(screen.getByTestId("is-hydrating")).toHaveTextContent("false");
		expect(screen.getByTestId("wallet-status")).toBeEmptyDOMElement();
		expect(screen.getByTestId("accounts-count")).toHaveTextContent("0");
	});
});
