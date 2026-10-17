import path from "node:path";
// Raw Playwright (not ../fixtures): the production builds initialise WalletConnect
// AppKit, which logs to the console in a headless run; this spec only reads the
// row's button label.
import { expect, type Page, test } from "@playwright/test";
import { BUTTON_RECORDER, buttonSequence } from "../buttonRecorder";

const MOCK_WALLETS_SCRIPT = path.join(
	__dirname,
	"..",
	"mocks",
	"mock-wallets.js",
);

const walletsTable = (page: Page) =>
	page
		.getByRole("table")
		.filter({ has: page.getByRole("columnheader", { name: "Accounts" }) });

/** Names of the wallets the persisted cache holds as connected, across both storage backends. */
const cachedConnectedWalletNames = (page: Page): Promise<string[]> =>
	page.evaluate(() => {
		try {
			const raw = localStorage.getItem("kheopskit");
			if (raw)
				return (JSON.parse(raw).cachedWallets ?? [])
					.filter((w: { isConnected: boolean }) => w.isConnected)
					.map((w: { name: string }) => w.name);
		} catch {}
		const entry = document.cookie
			.split("; ")
			.find((c) => c.startsWith("kheopskit="));
		if (!entry) return [];
		const value = JSON.parse(
			decodeURIComponent(entry.slice("kheopskit=".length)),
		);
		return (value.w ?? [])
			.filter((w: [string, string, number]) => w[2] === 1)
			.map((w: [string, string]) => w[1]);
	});

test("a remembered wallet shows Connecting… before Disconnect after a reload", async ({
	page,
}) => {
	await page.addInitScript({ path: MOCK_WALLETS_SCRIPT });
	await page.addInitScript(BUTTON_RECORDER);
	await page.addInitScript(() => {
		(window as { __dotEnableDelayMs?: number }).__dotEnableDelayMs = 500;
	});

	await page.goto("/");
	const row = walletsTable(page).getByRole("row", {
		name: /mock-polkadot-wallet/,
	});
	await row.getByRole("button", { name: "Connect" }).click();
	await expect(row.getByRole("button", { name: "Disconnect" })).toBeVisible();
	await expect
		.poll(() => cachedConnectedWalletNames(page), { timeout: 15_000 })
		.toContain("mock-polkadot-wallet");

	await page.reload();
	await expect(row.getByRole("button", { name: "Disconnect" })).toBeVisible({
		timeout: 15_000,
	});

	await expect
		.poll(() => buttonSequence(page))
		.toEqual(["Connecting… (disabled)", "Disconnect"]);
	expect(
		await page.evaluate(
			() => (window as { __dotEnableCalls?: number }).__dotEnableCalls,
		),
	).toBe(1);
});
