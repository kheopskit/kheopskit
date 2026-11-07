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
	"connected, accounts cached": { wallet: "connected", accounts: "cached" },
	reconnecting: { wallet: "connecting", accounts: "cached" },
	"cached, not found yet": {
		wallet: "connecting (cached)",
		accounts: "cached",
	},
	"failed, accounts cached": { wallet: "disconnected", accounts: "cached" },
} as const;

type Shown = keyof typeof SHOWN;

type Flags = { isDiscovering?: true; isHydrating?: true };

const DISCOVERING_HYDRATING: Flags = { isDiscovering: true, isHydrating: true };
const DISCOVERING: Flags = { isDiscovering: true };
const HYDRATING: Flags = { isHydrating: true };
const SETTLED: Flags = {};

type Shows = Partial<Record<Label, Shown>>;

/** The frame of a page where each wallet shows `shown`, except the `overrides`. */
const frame = (flags: Flags, shown: Shown, overrides: Shows = {}): Frame => {
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

/** One frame per change, each applied on top of the previous ones. */
const changes = (
	flags: Flags,
	shown: Shown,
	start: Shows,
	steps: Shows[],
): Frame[] => {
	let current = start;
	return steps.map((step) => {
		current = { ...current, ...step };
		return frame(flags, shown, current);
	});
};

const each = (labels: Label[], shown: Shown): Shows =>
	Object.fromEntries(labels.map((label) => [label, shown]));

const landing = (labels: Label[], shown: Shown = "connected"): Shows[] =>
	labels.map((label) => ({ [label]: shown }));

/**
 * The order the fakes' reconnects land in: Solana wallets answer one message,
 * Polkadot and Ethereum wallets two, and each wallet starts in the listed order.
 */
const RECONNECT_ORDER: Label[] = [
	"Talisman/solana",
	"Phantom/solana",
	"Talisman/polkadot",
	"SubWallet/polkadot",
	"Talisman/ethereum",
	"MetaMask/ethereum",
	"Phantom/ethereum",
	"SubWallet/ethereum",
];

const without = (labels: Label[], ...left: Label[]) =>
	labels.filter((label) => !left.includes(label));

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
	for (const label of LABELS)
		await page.framesDuring(() => page.wallet(label).connect());
	return page;
};

const reloadedPage = async (beforeReload: () => void = () => {}) => {
	(await connectedPage()).close();
	beforeReload();
	const page = loadPage();
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

		expect(page.frames).toEqual([
			frame(DISCOVERING, "disconnected", {
				"SubWallet/polkadot": "absent",
				"MetaMask/ethereum": "absent",
				"Phantom/ethereum": "absent",
				"SubWallet/ethereum": "absent",
				"Phantom/solana": "absent",
			}),
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

	it("Talisman's Disconnect All then Connect All on every platform empties, then refills, one platform per emission and Talisman's accounts only", async () => {
		const { talisman } = installWallets();
		const page = await connectedPage();

		expect(
			await page.framesDuring(() => {
				talisman.polkadot.disconnectAll();
				talisman.ethereum.disconnectAll();
				talisman.solana.disconnectAll();
			}),
		).toEqual(
			changes(
				SETTLED,
				"connected",
				{},
				landing(
					["Talisman/polkadot", "Talisman/ethereum", "Talisman/solana"],
					"connected without accounts",
				),
			),
		);
		const emptied = each(
			["Talisman/polkadot", "Talisman/ethereum", "Talisman/solana"],
			"connected without accounts",
		);
		expect(
			await page.framesDuring(() => {
				talisman.polkadot.connectAll();
				talisman.ethereum.connectAll();
				talisman.solana.connectAll();
			}),
		).toEqual(
			changes(
				SETTLED,
				"connected",
				emptied,
				landing(["Talisman/polkadot", "Talisman/solana", "Talisman/ethereum"]),
			),
		);
	});

	describe("on reload", () => {
		it("each wallet's reconnect lands in its own emission, without a prompt, then discovery and hydration end", async () => {
			const wallets = installWallets();
			const page = await reloadedPage();

			expect(page.frames).toEqual([
				frame(DISCOVERING_HYDRATING, "reconnecting"),
				...changes(
					DISCOVERING_HYDRATING,
					"reconnecting",
					{},
					landing(RECONNECT_ORDER),
				),
				frame(DISCOVERING, "connected"),
				frame(SETTLED, "connected"),
			]);
			expect(wallets.metaMask.ethereum.promptsShown()).toBe(1);
		});

		it("an uninstalled wallet shows from the cache until discovery ends, then leaves with hydration", async () => {
			const { phantom } = installWallets();
			const page = await reloadedPage(() => {
				phantom.ethereum.uninstall();
				phantom.solana.uninstall();
			});

			const phantomCached: Shows = {
				"Phantom/ethereum": "cached, not found yet",
				"Phantom/solana": "cached, not found yet",
			};
			expect(page.frames).toEqual([
				frame(DISCOVERING_HYDRATING, "reconnecting", phantomCached),
				...changes(
					DISCOVERING_HYDRATING,
					"reconnecting",
					phantomCached,
					landing(
						without(RECONNECT_ORDER, "Phantom/ethereum", "Phantom/solana"),
					),
				),
				frame(SETTLED, "connected", {
					"Phantom/ethereum": "absent",
					"Phantom/solana": "absent",
				}),
			]);
		});

		it("a wallet the user revoked shows its connect popup once; refused, it shows disconnected, its cached accounts leave with hydration, and the next load leaves it alone", async () => {
			const { metaMask } = installWallets();
			const page = await reloadedPage(() => {
				metaMask.ethereum.disconnectAll();
				metaMask.ethereum.answerPrompts("refuse");
			});

			const mmRefused: Shows = {
				"MetaMask/ethereum": "failed, accounts cached",
			};
			expect(page.frames).toEqual([
				frame(DISCOVERING_HYDRATING, "reconnecting"),
				...changes(DISCOVERING_HYDRATING, "reconnecting", {}, [
					{ "Talisman/solana": "connected" },
					{ "Phantom/solana": "connected" },
					mmRefused,
					...landing(
						without(
							RECONNECT_ORDER,
							"Talisman/solana",
							"Phantom/solana",
							"MetaMask/ethereum",
						),
					),
				]),
				frame(DISCOVERING, "connected", {
					"MetaMask/ethereum": "disconnected",
				}),
				frame(SETTLED, "connected", { "MetaMask/ethereum": "disconnected" }),
			]);
			expect(metaMask.ethereum.promptsShown()).toBe(2);
			expect(page.wallet("MetaMask/ethereum").error?.code).toBe(
				"USER_REJECTED",
			);

			page.close();
			const next = loadPage();
			await settle();
			expect(metaMask.ethereum.promptsShown()).toBe(2);
			expect(next.frames.at(-1)).toEqual(
				frame(SETTLED, "connected", { "MetaMask/ethereum": "disconnected" }),
			);
		});

		it("a wallet the user revoked keeps its popup open past hydrationTimeout, shows connecting without accounts, then connected once approved", async () => {
			const { metaMask } = installWallets();
			const page = await reloadedPage(() => {
				metaMask.ethereum.disconnectAll();
				metaMask.ethereum.answerPrompts("hold");
			});
			expect(metaMask.ethereum.openPrompts()).toBe(1);
			metaMask.ethereum.releasePrompts("approve");
			await settle();

			const mmWaiting: Shows = { "MetaMask/ethereum": "reconnecting" };
			expect(page.frames).toEqual([
				frame(DISCOVERING_HYDRATING, "reconnecting"),
				...changes(
					DISCOVERING_HYDRATING,
					"reconnecting",
					mmWaiting,
					landing(without(RECONNECT_ORDER, "MetaMask/ethereum")),
				),
				frame(HYDRATING, "connected", mmWaiting),
				frame(SETTLED, "connected", { "MetaMask/ethereum": "connecting" }),
				frame(SETTLED, "connected"),
			]);
		});

		it("after Talisman's Disconnect All on every platform, Talisman's Polkadot reconnect fails and is retried on other wallets' emissions (#199), and its Solana reconnect opens a prompt (#198)", async () => {
			const { talisman } = installWallets();
			const page = await reloadedPage(() => {
				talisman.polkadot.disconnectAll();
				talisman.ethereum.disconnectAll();
				talisman.solana.disconnectAll();
				talisman.solana.answerPrompts("hold");
			});

			const failed: Shows = { "Talisman/polkadot": "failed, accounts cached" };
			const retrying: Shows = { "Talisman/polkadot": "reconnecting" };
			expect(page.frames).toEqual([
				frame(DISCOVERING_HYDRATING, "reconnecting"),
				...changes(DISCOVERING_HYDRATING, "reconnecting", {}, [
					failed,
					{ ...retrying, "Phantom/solana": "connected" },
					{ "SubWallet/polkadot": "connected" },
					{ "MetaMask/ethereum": "connected" },
					{ "Phantom/ethereum": "connected" },
					failed,
					{ ...retrying, "SubWallet/ethereum": "connected" },
					{ "Talisman/ethereum": "connected, accounts cached" },
					failed,
				]),
				frame(HYDRATING, "connected", {
					...failed,
					"Talisman/ethereum": "connected, accounts cached",
					"Talisman/solana": "reconnecting",
				}),
				frame(SETTLED, "connected", {
					"Talisman/polkadot": "disconnected",
					"Talisman/ethereum": "connected without accounts",
					"Talisman/solana": "connecting",
				}),
			]);
			expect(talisman.solana.openPrompts()).toBe(1);
			expect(page.wallet("Talisman/polkadot").error?.code).toBe(
				"CONNECT_FAILED",
			);
		});
	});
});
