import path from "node:path";
// Raw Playwright (not ../fixtures): the production builds initialise WalletConnect
// AppKit, which logs to the console in a headless run; this spec only reads the
// row's button label.
import { expect, type Page, test } from "@playwright/test";

const MOCK_WALLETS_SCRIPT = path.join(
	__dirname,
	"..",
	"mocks",
	"mock-wallets.js",
);

// Records, on every animation frame, the label of the button in the Ethereum
// mock's row (null while the row is absent). The reconnect window after a reload
// is shorter than a locator poll, so the label sequence is read back instead.
const BUTTON_RECORDER = `
(() => {
  const samples = [];
  window.__buttonSamples = samples;
  const tick = () => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) =>
      (tr.textContent || "").includes("Mock Ethereum Wallet"),
    );
    const button = row ? row.querySelector("button") : null;
    samples.push(button ? (button.textContent || "").trim() : null);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
`;

const labelSequence = (page: Page): Promise<string[]> =>
	page.evaluate(() =>
		(
			window as unknown as { __buttonSamples: (string | null)[] }
		).__buttonSamples
			.filter((label): label is string => label !== null)
			.filter((label, i, all) => i === 0 || label !== all[i - 1]),
	);

const walletsTable = (page: Page) =>
	page
		.getByRole("table")
		.filter({ has: page.getByRole("columnheader", { name: "Accounts" }) });

const persistedRemembered = (page: Page): Promise<string[]> =>
	page.evaluate(() => {
		try {
			const raw = localStorage.getItem("kheopskit");
			if (raw) return JSON.parse(raw).remembered ?? [];
		} catch {}
		const entry = document.cookie
			.split("; ")
			.find((c) => c.startsWith("kheopskit="));
		if (!entry) return [];
		const value = JSON.parse(
			decodeURIComponent(entry.slice("kheopskit=".length)),
		);
		return value.r ?? value.remembered ?? [];
	});

test("a remembered wallet shows Connecting… before Disconnect after a reload", async ({
	page,
}) => {
	await page.addInitScript({ path: MOCK_WALLETS_SCRIPT });
	await page.addInitScript(BUTTON_RECORDER);

	await page.goto("/");
	const row = walletsTable(page).getByRole("row", {
		name: /Mock Ethereum Wallet/,
	});
	await row.getByRole("button", { name: "Connect" }).click();
	await expect(row.getByRole("button", { name: "Disconnect" })).toBeVisible();
	await expect
		.poll(() => persistedRemembered(page), { timeout: 15_000 })
		.toContain("ethereum:xyz.kheopskit.mock");

	await page.reload();
	await expect(row.getByRole("button", { name: "Disconnect" })).toBeVisible({
		timeout: 15_000,
	});

	expect(await labelSequence(page)).toEqual(["Connecting…", "Disconnect"]);
});
