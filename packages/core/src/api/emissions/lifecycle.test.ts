import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../../testing";
import type { SyncableStorage } from "../../utils/storage";
import { ethereum } from "../ethereum/plugin";
import { polkadot } from "../polkadot/plugin";
import { solana } from "../solana/plugin";
import {
	betweenProviderEvents,
	installEthereumWallet,
	installPolkadotWallet,
	installSolanaWallet,
	uninstallAll,
} from "./fakeWallets";
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

describe.each([
	{
		name: "Polkadot",
		platform: polkadot,
		install: () =>
			installPolkadotWallet({
				key: "talisman",
				name: "Talisman",
				accounts: ["Alice"],
			}),
		chain: "",
	},
	{
		name: "Ethereum",
		platform: ethereum,
		install: () =>
			installEthereumWallet({
				rdns: "xyz.talisman",
				name: "Talisman",
				accounts: ["Alice"],
			}),
		chain: " @1",
	},
	{
		name: "Solana",
		platform: solana,
		install: () =>
			installSolanaWallet({ name: "Talisman", accounts: ["Alice"] }),
		chain: "",
	},
])(
	"kheopskit$ emissions of one wallet on $name",
	({ platform, install, chain }) => {
		const loadPage = () => openPage(storage, { platforms: [platform()] });
		const talisman = (status: string) =>
			`Talisman/${platform().platform} ${status}`;
		const account = (person: string) =>
			`Talisman/${platform().platform} ${person}${chain}`;

		const connectedPage = async () => {
			const { label } = install();
			const page = loadPage();
			await settle();
			await page.wallet(label).connect();
			await settle();
			return page;
		};

		it("discovery lists the installed wallet, then ends", async () => {
			install();
			const page = loadPage();
			await settle();

			expect(page.frames).toEqual([
				{
					isDiscovering: true,
					wallets: [talisman("disconnected")],
					accounts: [],
				},
				{ wallets: [talisman("disconnected")], accounts: [] },
			]);
		});

		it("connect shows the wallet connecting, then connected with its accounts", async () => {
			const { label } = install();
			const page = loadPage();

			expect(
				await page.framesDuring(() => page.wallet(label).connect()),
			).toEqual([
				{ wallets: [talisman("connecting")], accounts: [] },
				{ wallets: [talisman("connected")], accounts: [account("Alice")] },
			]);
		});

		it.skipIf(platform === solana)(
			"disconnect shows the wallet disconnected without accounts",
			async () => {
				const page = await connectedPage();

				expect(
					await page.framesDuring(() =>
						page.wallet(`Talisman/${platform().platform}`).disconnect(),
					),
				).toEqual([{ wallets: [talisman("disconnected")], accounts: [] }]);
			},
		);

		it("an account change in the wallet emits the new account list once", async () => {
			const wallet = install();
			const page = loadPage();
			await settle();
			await page.wallet(wallet.label).connect();

			expect(
				await page.framesDuring(() => wallet.setAccounts(["Alice", "Bob"])),
			).toEqual([
				{
					wallets: [talisman("connected")],
					accounts: [account("Alice"), account("Bob")],
				},
			]);
		});

		it("a wallet-side disconnect then reconnect emits the empty list, then the accounts", async () => {
			const wallet = install();
			const page = loadPage();
			await settle();
			await page.wallet(wallet.label).connect();

			expect(await page.framesDuring(wallet.disconnectAll)).toEqual([
				{ wallets: [talisman("connected")], accounts: [] },
			]);
			expect(await page.framesDuring(wallet.connectAll)).toEqual([
				{ wallets: [talisman("connected")], accounts: [account("Alice")] },
			]);
		});

		it("a reload shows the cached wallet and accounts, swaps in the live ones, then ends hydration and discovery", async () => {
			(await connectedPage()).close();

			const page = loadPage();
			await settle();

			expect(page.frames).toEqual([
				{
					isDiscovering: true,
					isHydrating: true,
					wallets: [talisman("connecting")],
					accounts: [`${account("Alice")} (cached)`],
				},
				{
					isDiscovering: true,
					isHydrating: true,
					wallets: [talisman("connected")],
					accounts: [account("Alice")],
				},
				{
					isDiscovering: true,
					wallets: [talisman("connected")],
					accounts: [account("Alice")],
				},
				{ wallets: [talisman("connected")], accounts: [account("Alice")] },
			]);
		});
	},
);

it("disconnect on Solana shows the wallet connected without accounts, then disconnected (#197)", async () => {
	const { label } = installSolanaWallet({
		name: "Talisman",
		accounts: ["Alice"],
	});
	const page = openPage(storage, { platforms: [solana()] });
	await settle();
	await page.wallet(label).connect();

	expect(
		await page.framesDuring(() => page.wallet(label).disconnect()),
	).toEqual([
		{ wallets: ["Talisman/solana connected"], accounts: [] },
		{ wallets: ["Talisman/solana disconnected"], accounts: [] },
	]);
});

describe("kheopskit$ emissions of one Ethereum wallet", () => {
	const install = () =>
		installEthereumWallet({
			rdns: "xyz.talisman",
			name: "Talisman",
			accounts: ["Alice"],
		});
	const loadPage = () => openPage(storage, { platforms: [ethereum()] });

	it("a chain change emits the accounts on the new chain once", async () => {
		const wallet = install();
		const page = loadPage();
		await settle();
		await page.wallet(wallet.label).connect();

		expect(await page.framesDuring(() => wallet.switchChain("0x89"))).toEqual([
			{
				wallets: ["Talisman/ethereum connected"],
				accounts: ["Talisman/ethereum Alice @137"],
			},
		]);
	});

	it.each([
		{
			change: "a chain switch",
			held: "eth_requestAccounts",
			accounts: ["Talisman/ethereum Alice @137"],
		},
		{
			change: "a chain switch",
			held: "eth_chainId",
			accounts: ["Talisman/ethereum Alice @137"],
		},
		{
			change: "an account change",
			held: "eth_requestAccounts",
			accounts: ["Talisman/ethereum Bob @1"],
		},
		{
			change: "an account change",
			held: "eth_chainId",
			accounts: ["Talisman/ethereum Bob @1"],
		},
	] as const)(
		"connect lists the wallet's accounts as of $change while $held is answered",
		async ({ change, held, accounts }) => {
			const wallet = install();
			const page = loadPage();
			wallet.hold(held);

			expect(
				await page.framesDuring(async () => {
					const connecting = page.wallet(wallet.label).connect();
					await betweenProviderEvents();
					if (change === "a chain switch") wallet.switchChain("0x89");
					else wallet.setAccounts(["Bob"]);
					await betweenProviderEvents();
					wallet.release(held);
					await connecting;
				}),
			).toEqual([
				{ wallets: ["Talisman/ethereum connecting"], accounts: [] },
				{ wallets: ["Talisman/ethereum connected"], accounts },
			]);
		},
	);
});
