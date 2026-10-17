import { writeFile } from "node:fs/promises";
import type { Page, TestInfo } from "@playwright/test";

export { expect, test } from "../../../e2e/fixtures";

export const walletsTable = (page: Page) =>
	page
		.getByRole("table")
		.filter({ has: page.getByRole("columnheader", { name: "Accounts" }) });

export const accountsTable = (page: Page) =>
	page
		.getByRole("table")
		.filter({ has: page.getByRole("columnheader", { name: "Address" }) });

export const MOCK_WALLETS = {
	polkadot: { wallet: /mock-polkadot-wallet/, account: /Mock Account/ },
	ethereum: {
		wallet: /Mock Ethereum Wallet/,
		account: /Mock Ethereum Wallet/,
	},
	solana: { wallet: /Mock Solana Wallet/, account: /Mock Solana Wallet/ },
} as const;

export const snap = async (page: Page, testInfo: TestInfo, name: string) => {
	await page.screenshot({
		path: testInfo.outputPath(`${name}.png`),
		fullPage: true,
		animations: "disabled",
	});
	await writeFile(
		testInfo.outputPath(`${name}.aria.yml`),
		await page.locator("body").ariaSnapshot(),
	);
};

export const readPersistedState = (page: Page) =>
	page.evaluate(() => {
		const cookieEntry = document.cookie
			.split("; ")
			.find((c) => c.startsWith("kheopskit="));
		const cookie = cookieEntry
			? decodeURIComponent(cookieEntry.slice("kheopskit=".length))
			: null;
		const stored = localStorage.getItem("kheopskit");
		const remembered: string[] | null =
			(stored
				? JSON.parse(stored).remembered
				: cookie && JSON.parse(cookie).r) ?? null;
		return { localStorage: stored, cookie, remembered };
	});

export const saveJson = (testInfo: TestInfo, name: string, value: unknown) =>
	writeFile(
		testInfo.outputPath(`${name}.json`),
		JSON.stringify(value, null, 2),
	);
