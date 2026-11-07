import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../../testing";
import type { SyncableStorage } from "../../utils/storage";
import { ethereum } from "../ethereum/plugin";
import { polkadot } from "../polkadot/plugin";
import { solana } from "../solana/plugin";
import {
	installMetaMask,
	installPhantom,
	installSubWallet,
	installTalisman,
	uninstallAll,
} from "./fakeWallets";
import { closeAllPages, type Frame, openPage, settle } from "./page";

const ACCOUNTS = {
	"Talisman/polkadot": ["Alice"],
	"SubWallet/polkadot": ["Alice"],
	"Talisman/ethereum": ["Alice @1"],
	"MetaMask/ethereum": ["Alice @1"],
	"Phantom/ethereum": ["Bob @1"],
	"SubWallet/ethereum": ["Alice @1"],
	"Talisman/solana": ["Alice"],
	"Phantom/solana": ["Bob"],
} as const;

type Label = keyof typeof ACCOUNTS;

const LABELS = Object.keys(ACCOUNTS) as Label[];

const SHOWN = {
	absent: undefined,
	disconnected: { wallet: "disconnected", accounts: "none" },
	connecting: { wallet: "connecting", accounts: "none" },
	connected: { wallet: "connected", accounts: "live" },
	"connected without accounts": { wallet: "connected", accounts: "none" },
	reconnecting: { wallet: "connecting", accounts: "cached" },
	"cached, not found yet": {
		wallet: "connecting (cached)",
		accounts: "cached",
	},
	"refused, accounts cached": { wallet: "disconnected", accounts: "cached" },
} as const;

type Shown = keyof typeof SHOWN;

type Flags = { isDiscovering?: true; isHydrating?: true };

const DISCOVERING_HYDRATING: Flags = { isDiscovering: true, isHydrating: true };
const DISCOVERING: Flags = { isDiscovering: true };
const HYDRATING: Flags = { isHydrating: true };
const SETTLED: Flags = {};

/** The frame of a page where each wallet shows `shown`, except the `overrides`. */
const frame = (
	flags: Flags,
	shown: Shown,
	overrides: Partial<Record<Label, Shown>> = {},
): Frame => {
	const wallets: string[] = [];
	const accounts: string[] = [];
	for (const label of LABELS) {
		const view = SHOWN[overrides[label] ?? shown];
		if (!view) continue;
		wallets.push(`${label} ${view.wallet}`);
		if (view.accounts === "none") continue;
		const suffix = view.accounts === "cached" ? " (cached)" : "";
		for (const account of ACCOUNTS[label])
			accounts.push(`${label} ${account}${suffix}`);
	}
	return { ...flags, wallets, accounts };
};

const each = (labels: Label[], shown: Shown) =>
	Object.fromEntries(labels.map((label) => [label, shown]));

const POLKADOT_AND_SOLANA: Label[] = [
	"Talisman/polkadot",
	"SubWallet/polkadot",
	"Talisman/solana",
	"Phantom/solana",
];

let storage: SyncableStorage;

beforeEach(() => {
	vi.useFakeTimers();
	storage = createMemoryStorage();
});

afterEach(() => {
	closeAllPages();
	uninstallAll();
	vi.useRealTimers();
});

const loadPage = () =>
	openPage(storage, { platforms: [polkadot(), ethereum(), solana()] });

/** A user with Talisman, SubWallet, MetaMask and Phantom installed. */
const installWallets = () => ({
	talisman: installTalisman(),
	subWallet: installSubWallet(),
	metaMask: installMetaMask(),
	phantom: installPhantom(),
});

const connectedPage = async () => {
	const page = loadPage();
	await settle();
	for (const label of LABELS) await page.wallet(label).connect();
	await settle();
	return page;
};

describe("kheopskit$ emissions for a user with Talisman, SubWallet, MetaMask and Phantom", () => {
	it("discovery lists every wallet of every platform in the first emission, then ends", async () => {
		installWallets();
		const page = loadPage();
		await settle();

		expect(page.frames).toEqual([
			frame(DISCOVERING, "disconnected"),
			frame(SETTLED, "disconnected"),
		]);
	});

	it("discovery lists wallets injected after load at their next registry read", async () => {
		installTalisman();
		const page = loadPage();
		await vi.advanceTimersByTimeAsync(250);
		installSubWallet();
		installPhantom();
		await settle();

		const talismanOnly = {
			"SubWallet/polkadot": "absent",
			"MetaMask/ethereum": "absent",
			"Phantom/ethereum": "absent",
			"SubWallet/ethereum": "absent",
			"Phantom/solana": "absent",
		} as const;
		expect(page.frames).toEqual([
			frame(DISCOVERING, "disconnected", talismanOnly),
			frame(DISCOVERING, "disconnected", {
				"SubWallet/polkadot": "absent",
				"MetaMask/ethereum": "absent",
			}),
			frame(DISCOVERING, "disconnected", { "MetaMask/ethereum": "absent" }),
			frame(SETTLED, "disconnected", { "MetaMask/ethereum": "absent" }),
		]);
	});

	it("connecting each wallet in turn emits it connecting, then connected with its accounts, and leaves the others as they were", async () => {
		installWallets();
		const page = loadPage();
		await settle();

		for (const [index, label] of LABELS.entries()) {
			const before = {
				...each(LABELS.slice(0, index), "connected"),
				...each(LABELS.slice(index + 1), "disconnected"),
			};
			expect(
				await page.framesDuring(() => page.wallet(label).connect()),
			).toEqual([
				frame(SETTLED, "connecting", before),
				frame(SETTLED, "connected", before),
			]);
		}
	});

	it("an account change in one wallet emits once and changes that wallet's accounts only", async () => {
		const { subWallet } = installWallets();
		const page = await connectedPage();

		const expected = frame(SETTLED, "connected");
		expected.accounts.splice(
			expected.accounts.indexOf("SubWallet/ethereum Alice @1") + 1,
			0,
			"SubWallet/ethereum Bob @1",
		);
		expect(
			await page.framesDuring(() =>
				subWallet.ethereum.setAccounts(["Alice", "Bob"]),
			),
		).toEqual([expected]);
	});

	it("disconnecting one wallet emits once and leaves the others connected", async () => {
		installWallets();
		const page = await connectedPage();

		expect(
			await page.framesDuring(() =>
				page.wallet("MetaMask/ethereum").disconnect(),
			),
		).toEqual([
			frame(SETTLED, "connected", { "MetaMask/ethereum": "disconnected" }),
		]);
	});

	it("Talisman's Disconnect All then Connect All on every platform empties and refills Talisman's accounts only", async () => {
		const { talisman } = installWallets();
		const page = await connectedPage();
		const talismanLabels: Label[] = [
			"Talisman/polkadot",
			"Talisman/ethereum",
			"Talisman/solana",
		];

		expect(
			await page.framesDuring(() =>
				Promise.all([
					talisman.polkadot.disconnectAll(),
					talisman.ethereum.disconnectAll(),
					talisman.solana.disconnectAll(),
				]),
			),
		).toEqual([
			frame(
				SETTLED,
				"connected",
				each(talismanLabels, "connected without accounts"),
			),
		]);
		expect(
			await page.framesDuring(() =>
				Promise.all([
					talisman.polkadot.connectAll(),
					talisman.ethereum.connectAll(),
					talisman.solana.connectAll(),
				]),
			),
		).toEqual([
			frame(SETTLED, "connected", {
				"Talisman/ethereum": "connected without accounts",
			}),
			frame(SETTLED, "connected"),
		]);
	});

	describe("on reload", () => {
		it("every wallet reconnects, Polkadot and Solana first, then Ethereum, then hydration and discovery end", async () => {
			installWallets();
			(await connectedPage()).close();

			const page = loadPage();
			await settle();

			expect(page.frames).toEqual([
				frame(DISCOVERING_HYDRATING, "reconnecting"),
				frame(
					DISCOVERING_HYDRATING,
					"reconnecting",
					each(POLKADOT_AND_SOLANA, "connected"),
				),
				frame(DISCOVERING_HYDRATING, "connected"),
				frame(DISCOVERING, "connected"),
				frame(SETTLED, "connected"),
			]);
		});

		it("an uninstalled wallet shows from the cache until discovery ends, then leaves with hydration", async () => {
			const { phantom } = installWallets();
			(await connectedPage()).close();
			phantom.ethereum.uninstall();
			phantom.solana.uninstall();

			const page = loadPage();
			await settle();

			const phantomCached = {
				"Phantom/ethereum": "cached, not found yet",
				"Phantom/solana": "cached, not found yet",
			} as const;
			expect(page.frames).toEqual([
				frame(DISCOVERING_HYDRATING, "reconnecting", phantomCached),
				frame(DISCOVERING_HYDRATING, "reconnecting", {
					...each(POLKADOT_AND_SOLANA, "connected"),
					...phantomCached,
				}),
				frame(DISCOVERING_HYDRATING, "connected", phantomCached),
				frame(SETTLED, "connected", {
					"Phantom/ethereum": "absent",
					"Phantom/solana": "absent",
				}),
			]);
		});

		it("a wallet that refuses its reconnect is asked once, shows disconnected, and its cached accounts leave when hydration ends", async () => {
			const { metaMask } = installWallets();
			(await connectedPage()).close();
			metaMask.ethereum.answerConnects("refuse");

			const page = loadPage();
			await settle();

			expect(page.frames).toEqual([
				frame(DISCOVERING_HYDRATING, "reconnecting"),
				frame(
					DISCOVERING_HYDRATING,
					"reconnecting",
					each(POLKADOT_AND_SOLANA, "connected"),
				),
				frame(DISCOVERING_HYDRATING, "connected", {
					"MetaMask/ethereum": "refused, accounts cached",
					"Phantom/ethereum": "reconnecting",
					"SubWallet/ethereum": "reconnecting",
				}),
				frame(DISCOVERING_HYDRATING, "connected", {
					"MetaMask/ethereum": "refused, accounts cached",
				}),
				frame(DISCOVERING, "connected", {
					"MetaMask/ethereum": "disconnected",
				}),
				frame(SETTLED, "connected", { "MetaMask/ethereum": "disconnected" }),
			]);
		});

		it("a locked wallet holds hydration until hydrationTimeout, shows connecting without accounts, then connected once unlocked", async () => {
			const { metaMask } = installWallets();
			(await connectedPage()).close();
			metaMask.ethereum.answerConnects("hold");

			const page = loadPage();
			await settle();
			metaMask.ethereum.grantHeldConnects();
			await settle();

			const metaMaskReconnecting = {
				"MetaMask/ethereum": "reconnecting",
			} as const;
			expect(page.frames).toEqual([
				frame(DISCOVERING_HYDRATING, "reconnecting"),
				frame(
					DISCOVERING_HYDRATING,
					"reconnecting",
					each(POLKADOT_AND_SOLANA, "connected"),
				),
				frame(DISCOVERING_HYDRATING, "connected", metaMaskReconnecting),
				frame(HYDRATING, "connected", metaMaskReconnecting),
				frame(SETTLED, "connected", { "MetaMask/ethereum": "connecting" }),
				frame(SETTLED, "connected"),
			]);
		});
	});
});
