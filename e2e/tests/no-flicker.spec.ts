import path from "node:path";
// Raw Playwright (not ../fixtures): the production builds initialise WalletConnect
// AppKit (a real projectId lives in each app's .env), which logs to the console
// in a headless/offline run. The shared fixture fails on any console error, which
// is noise here — this spec only cares about render output, so it owns its setup.
import { expect, type Page, test } from "@playwright/test";

const MOCK_WALLETS_SCRIPT = path.join(
	__dirname,
	"..",
	"mocks",
	"mock-wallets.js",
);

// Recorder injected before app code (runs on every navigation, incl. reload).
// Every animation frame it records:
//   w -> wallets table data-row count (-1 = table absent; 0 = present but EMPTY)
//   a -> the accounts table platform order, one entry per row (e.g. ["polkadot"])
// The wallets table is the one with an "Accounts" column header; the accounts
// table the one with an "Address" header (both share "Platform"/"Wallet").
const RECORDER_SCRIPT = `
(() => {
  const samples = [];
  window.__renderSamples = samples;
  const findTable = (header) => {
    for (const table of document.querySelectorAll("table")) {
      const headers = Array.from(table.querySelectorAll("th")).map(
        (th) => (th.textContent || "").trim(),
      );
      if (headers.includes(header)) return table;
    }
    return null;
  };
  const tick = () => {
    const walletsTable = findTable("Accounts");
    const accountsTable = findTable("Address");
    const w = walletsTable
      ? walletsTable.querySelectorAll("tbody tr").length
      : -1;
    const a = accountsTable
      ? Array.from(accountsTable.querySelectorAll("tbody tr")).map((row) =>
          (row.querySelector("td")?.textContent || "").trim(),
        )
      : [];
    samples.push({ w, a });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
`;

type Sample = { w: number; a: string[] };

const readSamples = (page: Page): Promise<Sample[]> =>
	page.evaluate(
		() => (window as unknown as { __renderSamples: Sample[] }).__renderSamples,
	);

/** Number of wallets currently persisted, across both storage backends. */
const persistedWalletCount = (page: Page): Promise<number> =>
	page.evaluate(() => {
		const counts = [0];
		try {
			const raw = localStorage.getItem("kheopskit");
			if (raw) counts.push(JSON.parse(raw).cachedWallets?.length ?? 0);
		} catch {}
		try {
			const entry = document.cookie
				.split("; ")
				.find((c) => c.startsWith("kheopskit="));
			if (entry) {
				const value = JSON.parse(
					decodeURIComponent(entry.slice("kheopskit=".length)),
				);
				counts.push(value.w?.length ?? value.cachedWallets?.length ?? 0);
			}
		} catch {}
		return Math.max(...counts);
	});

/** Number of accounts currently persisted, across both storage backends. */
const persistedAccountCount = (page: Page): Promise<number> =>
	page.evaluate(() => {
		const counts = [0];
		try {
			const raw = localStorage.getItem("kheopskit");
			if (raw) counts.push(JSON.parse(raw).cachedAccounts?.length ?? 0);
		} catch {}
		try {
			const entry = document.cookie
				.split("; ")
				.find((c) => c.startsWith("kheopskit="));
			if (entry) {
				const value = JSON.parse(
					decodeURIComponent(entry.slice("kheopskit=".length)),
				);
				counts.push(value.a?.length ?? value.cachedAccounts?.length ?? 0);
			}
		} catch {}
		return Math.max(...counts);
	});

const walletsTable = (page: Page) =>
	page
		.getByRole("table")
		.filter({ has: page.getByRole("columnheader", { name: "Accounts" }) });

const accountsTable = (page: Page) =>
	page
		.getByRole("table")
		.filter({ has: page.getByRole("columnheader", { name: "Address" }) });

test("reloading does not flash an empty wallet list", async ({ page }) => {
	await page.addInitScript({ path: MOCK_WALLETS_SCRIPT });
	await page.addInitScript(RECORDER_SCRIPT);

	// First visit: discover the mock wallets and let kheopskit persist them
	// (hydration grace period + debounced write).
	await page.goto("/");

	const rows = walletsTable(page).locator("tbody tr");
	// WalletConnect is configured in every app's .env, so the list also includes
	// the AppKit wallet rows (≥3 = the three injected mocks at minimum).
	await expect
		.poll(() => rows.count(), { timeout: 15_000 })
		.toBeGreaterThanOrEqual(3);

	await expect
		.poll(() => persistedWalletCount(page), {
			timeout: 15_000,
			message: "wallets were never persisted to storage",
		})
		.toBeGreaterThanOrEqual(3);

	// Reload: the recorder restarts fresh. This is the path that used to flash an
	// empty list before painting the cached wallets.
	await page.reload();

	await expect
		.poll(() => rows.count(), { timeout: 15_000 })
		.toBeGreaterThanOrEqual(3);
	await page.waitForTimeout(500);

	const rendered = (await readSamples(page))
		.map((s) => s.w)
		.filter((w) => w >= 0);
	expect(rendered.length, "wallets table should have rendered").toBeGreaterThan(
		0,
	);

	// The regression: the table is present but empty on the first frame(s), then
	// fills in once the (async) observable emits. Assert it was never shown empty.
	const emptyFrames = rendered.filter((w) => w === 0).length;
	expect(
		emptyFrames,
		`wallets table flashed empty on ${emptyFrames} frame(s) after reload; first counts: ${rendered.slice(0, 10).join(",")}`,
	).toBe(0);
	expect(
		rendered[0],
		"first painted frame should show cached wallets",
	).toBeGreaterThanOrEqual(3);
});

test("reloading does not reorder the accounts list", async ({ page }) => {
	await page.addInitScript({ path: MOCK_WALLETS_SCRIPT });
	await page.addInitScript(RECORDER_SCRIPT);

	await page.goto("/");

	// Connect the three injected mock wallets (NOT the WalletConnect rows) so
	// their accounts are persisted across reload.
	for (const name of [
		/mock-polkadot-wallet/,
		/Mock Ethereum Wallet/,
		/Mock Solana Wallet/,
	]) {
		const walletRow = walletsTable(page).getByRole("row", { name });
		await walletRow.getByRole("button", { name: "Connect" }).click();
		await expect(
			walletRow.getByRole("button", { name: "Disconnect" }),
		).toBeVisible({ timeout: 15_000 });
	}

	const accountRows = accountsTable(page).locator("tbody tr");
	await expect.poll(() => accountRows.count(), { timeout: 15_000 }).toBe(3);

	await expect
		.poll(() => persistedAccountCount(page), {
			timeout: 15_000,
			message: "accounts were never persisted to storage",
		})
		.toBeGreaterThanOrEqual(3);

	// Reload: wallets auto-reconnect (config.autoReconnect), so live accounts come
	// back in an arbitrary order. The list must stay in its sorted order the whole
	// time rather than reshuffling as each wallet reconnects.
	await page.reload();

	await expect.poll(() => accountRows.count(), { timeout: 15_000 }).toBe(3);
	await page.waitForTimeout(1500);

	const samples = await readSamples(page);

	// Canonical sortAccounts order: polkadot, then ethereum, then solana.
	const SORTED = ["polkadot", "ethereum", "solana"];

	// Among every frame where all three accounts were present, the platform order
	// must already be the sorted one — never a transient reshuffle.
	const fullFrames = samples.map((s) => s.a).filter((a) => a.length === 3);
	expect(
		fullFrames.length,
		"accounts table should have rendered 3 rows",
	).toBeGreaterThan(0);

	const distinctOrders = [...new Set(fullFrames.map((a) => a.join(",")))];
	expect(
		distinctOrders,
		`accounts reordered across frames after reload: ${distinctOrders.join(" | ")}`,
	).toEqual([SORTED.join(",")]);
});
