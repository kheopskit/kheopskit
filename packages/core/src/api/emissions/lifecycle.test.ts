import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../../testing";
import type { SyncableStorage } from "../../utils/storage";
import { ethereum } from "../ethereum/plugin";
import { polkadot } from "../polkadot/plugin";
import { solana } from "../solana/plugin";
import { installTalisman, uninstallAll } from "./fakeWallets";
import { closeAllPages, openPage, settle } from "./page";

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

const PLATFORMS = {
	polkadot: { plugin: polkadot, alice: "Alice", changed: ["Alice", "Bob"] },
	ethereum: {
		plugin: ethereum,
		alice: "Alice @1",
		changed: ["Alice @1", "Bob @1"],
	},
	solana: { plugin: solana, alice: "Alice", changed: ["Bob"] },
} as const;

type PlatformName = keyof typeof PLATFORMS;

const talismanOn = <Name extends PlatformName>(name: Name) => {
	const wallet: ReturnType<typeof installTalisman>[Name] =
		installTalisman()[name];
	const { plugin, alice, changed } = PLATFORMS[name];
	const loadPage = () => openPage(storage, { platforms: [plugin()] });
	const shows = (status: string) => `${wallet.label} ${status}`;
	const account = (label: string) => `${wallet.label} ${label}`;
	const connectedPage = async () => {
		const page = loadPage();
		await page.framesDuring(() => page.wallet(wallet.label).connect());
		return page;
	};
	const reloadedPage = async () => {
		(await connectedPage()).close();
		const page = loadPage();
		await settle();
		return page;
	};
	return {
		wallet,
		loadPage,
		connectedPage,
		reloadedPage,
		shows,
		alice: account(alice),
		changed: changed.map(account),
	};
};

describe.each(Object.keys(PLATFORMS) as PlatformName[])(
	"kheopskit$ emissions of Talisman on %s",
	(name) => {
		it("discovery lists the installed wallet, then ends", async () => {
			const { loadPage, shows } = talismanOn(name);
			const page = loadPage();
			await settle();

			expect(page.frames).toEqual([
				{ isDiscovering: true, wallets: [shows("disconnected")], accounts: [] },
				{ wallets: [shows("disconnected")], accounts: [] },
			]);
		});

		it("a connect the user approves shows the wallet connecting, then connected with its accounts", async () => {
			const { wallet, loadPage, shows, alice } = talismanOn(name);
			const page = loadPage();

			expect(
				await page.framesDuring(() => page.wallet(wallet.label).connect()),
			).toEqual([
				{ wallets: [shows("connecting")], accounts: [] },
				{ wallets: [shows("connected")], accounts: [alice] },
			]);
			expect(wallet.promptsShown()).toBe(1);
		});

		it("a connect the user refuses shows the wallet connecting, then disconnected with USER_REJECTED", async () => {
			const { wallet, loadPage, shows } = talismanOn(name);
			const page = loadPage();
			wallet.answerPrompts("refuse");

			expect(
				await page.framesDuring(() =>
					page
						.wallet(wallet.label)
						.connect()
						.catch(() => {}),
				),
			).toEqual([
				{ wallets: [shows("connecting")], accounts: [] },
				{ wallets: [shows("disconnected")], accounts: [] },
			]);
			expect(page.wallet(wallet.label).error?.code).toBe("USER_REJECTED");
		});

		it("an account change in the wallet emits the new account list once", async () => {
			const { wallet, connectedPage, shows, changed } = talismanOn(name);
			const page = await connectedPage();

			expect(
				await page.framesDuring(() =>
					wallet.setAccounts(name === "solana" ? ["Bob"] : ["Alice", "Bob"]),
				),
			).toEqual([{ wallets: [shows("connected")], accounts: changed }]);
		});

		it("Talisman's Disconnect All then Connect All emits the empty list, then the accounts, with the wallet connected throughout", async () => {
			const { wallet, connectedPage, shows, alice } = talismanOn(name);
			const page = await connectedPage();

			expect(await page.framesDuring(wallet.disconnectAll)).toEqual([
				{ wallets: [shows("connected")], accounts: [] },
			]);
			expect(await page.framesDuring(wallet.connectAll)).toEqual([
				{ wallets: [shows("connected")], accounts: [alice] },
			]);
		});

		it("a reload shows the cached accounts, swaps in the live ones without a prompt, then ends hydration and discovery", async () => {
			const { wallet, reloadedPage, shows, alice } = talismanOn(name);
			const page = await reloadedPage();

			expect(page.frames).toEqual([
				{
					isDiscovering: true,
					isHydrating: true,
					wallets: [shows("connecting")],
					accounts: [`${alice} (cached)`],
				},
				{
					isDiscovering: true,
					isHydrating: true,
					wallets: [shows("connected")],
					accounts: [alice],
				},
				{
					isDiscovering: true,
					wallets: [shows("connected")],
					accounts: [alice],
				},
				{ wallets: [shows("connected")], accounts: [alice] },
			]);
			expect(wallet.promptsShown()).toBe(1);
		});
	},
);

describe("kheopskit$ emissions of a disconnect from the app", () => {
	it.each(["polkadot", "ethereum"] as const)(
		"on %s, shows the wallet disconnected without accounts, and the wallet keeps the site authorized",
		async (name) => {
			const { wallet, connectedPage, shows } = talismanOn(name);
			const page = await connectedPage();

			expect(
				await page.framesDuring(() => page.wallet(wallet.label).disconnect()),
			).toEqual([{ wallets: [shows("disconnected")], accounts: [] }]);
			await page.framesDuring(() => page.wallet(wallet.label).connect());
			expect(wallet.promptsShown()).toBe(1);
		},
	);

	it("on Solana, shows the wallet connected without accounts, then disconnected (#197), and Talisman forgets the site", async () => {
		const { wallet, connectedPage, shows } = talismanOn("solana");
		const page = await connectedPage();

		expect(
			await page.framesDuring(() => page.wallet(wallet.label).disconnect()),
		).toEqual([
			{ wallets: [shows("connected")], accounts: [] },
			{ wallets: [shows("disconnected")], accounts: [] },
		]);
		await page.framesDuring(() => page.wallet(wallet.label).connect());
		expect(wallet.promptsShown()).toBe(2);
	});
});

describe("kheopskit$ emissions of a reload after Talisman's Disconnect All", () => {
	const reloadAfterDisconnectAll = async (name: PlatformName) => {
		const talisman = talismanOn(name);
		(await talisman.connectedPage()).close();
		talisman.wallet.disconnectAll();
		return talisman;
	};

	it("on Polkadot, Talisman rejects the reconnect without a prompt, and the wallet shows disconnected with CONNECT_FAILED", async () => {
		const { wallet, loadPage, shows, alice } =
			await reloadAfterDisconnectAll("polkadot");
		const page = loadPage();
		await settle();

		expect(page.frames).toEqual([
			{
				isDiscovering: true,
				isHydrating: true,
				wallets: [shows("connecting")],
				accounts: [`${alice} (cached)`],
			},
			{
				isDiscovering: true,
				isHydrating: true,
				wallets: [shows("disconnected")],
				accounts: [`${alice} (cached)`],
			},
			{ isDiscovering: true, wallets: [shows("disconnected")], accounts: [] },
			{ wallets: [shows("disconnected")], accounts: [] },
		]);
		expect(page.wallet(wallet.label).error?.code).toBe("CONNECT_FAILED");
		expect(wallet.promptsShown()).toBe(1);
	});

	it("on Ethereum, Talisman answers no account without a prompt, and the wallet shows connected without accounts once hydration ends", async () => {
		const { wallet, loadPage, shows, alice } =
			await reloadAfterDisconnectAll("ethereum");
		const page = loadPage();
		await settle();

		expect(page.frames).toEqual([
			{
				isDiscovering: true,
				isHydrating: true,
				wallets: [shows("connecting")],
				accounts: [`${alice} (cached)`],
			},
			{
				isDiscovering: true,
				isHydrating: true,
				wallets: [shows("connected")],
				accounts: [`${alice} (cached)`],
			},
			{ isDiscovering: true, wallets: [shows("connected")], accounts: [] },
			{ wallets: [shows("connected")], accounts: [] },
		]);
		expect(wallet.promptsShown()).toBe(1);
	});

	it("on Solana, the reconnect opens Talisman's connect prompt during the page load (#198)", async () => {
		const { wallet, loadPage, shows, alice } =
			await reloadAfterDisconnectAll("solana");
		wallet.answerPrompts("hold");
		const page = loadPage();
		await settle();

		expect(wallet.openPrompts()).toBe(1);
		expect(page.frames).toEqual([
			{
				isDiscovering: true,
				isHydrating: true,
				wallets: [shows("connecting")],
				accounts: [`${alice} (cached)`],
			},
			{
				isHydrating: true,
				wallets: [shows("connecting")],
				accounts: [`${alice} (cached)`],
			},
			{ wallets: [shows("connecting")], accounts: [] },
		]);
	});
});

describe("kheopskit$ emissions of Talisman on Ethereum", () => {
	it("a chain change emits the accounts on the new chain once", async () => {
		const { wallet, connectedPage } = talismanOn("ethereum");
		const page = await connectedPage();

		expect(await page.framesDuring(() => wallet.switchChain("0x89"))).toEqual([
			{
				wallets: ["Talisman/ethereum connected"],
				accounts: ["Talisman/ethereum Alice @137"],
			},
		]);
	});

	it("a connect approved after the user switched chain in the open prompt lists the accounts on the new chain only", async () => {
		const { wallet, loadPage } = talismanOn("ethereum");
		const page = loadPage();
		wallet.answerPrompts("hold");

		expect(
			await page.framesDuring(async () => {
				const connecting = page.wallet(wallet.label).connect();
				await vi.advanceTimersByTimeAsync(10);
				wallet.switchChain("0x89");
				await vi.advanceTimersByTimeAsync(10);
				wallet.releasePrompts("approve");
				await connecting;
			}),
		).toEqual([
			{ wallets: ["Talisman/ethereum connecting"], accounts: [] },
			{
				wallets: ["Talisman/ethereum connected"],
				accounts: ["Talisman/ethereum Alice @137"],
			},
		]);
	});

	it("a connect whose account switch reaches the page before the chain answer lists the new account only", async () => {
		const { wallet, loadPage } = talismanOn("ethereum");
		const page = loadPage();
		wallet.holdChainRead();

		expect(
			await page.framesDuring(async () => {
				const connecting = page.wallet(wallet.label).connect();
				await vi.advanceTimersByTimeAsync(10);
				wallet.setAccounts(["Bob"]);
				await vi.advanceTimersByTimeAsync(10);
				wallet.answerChainRead();
				await connecting;
			}),
		).toEqual([
			{ wallets: ["Talisman/ethereum connecting"], accounts: [] },
			{
				wallets: ["Talisman/ethereum connected"],
				accounts: ["Talisman/ethereum Bob @1"],
			},
		]);
	});
});
