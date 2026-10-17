import type { Page } from "@playwright/test";
import {
	accountsTable,
	expect,
	MOCK_WALLETS,
	readPersistedState,
	saveJson,
	snap,
	test,
	walletsTable,
} from "../helpers";

// The Connecting… window after a reload is shorter than a locator poll, so the
// label is sampled every animation frame and the sequence read back.
const BUTTON_RECORDER = `
(() => {
  const samples = [];
  window.__buttonSamples = samples;
  const tick = () => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) =>
      (tr.textContent || "").includes("mock-polkadot-wallet") && tr.querySelector("button"),
    );
    samples.push(row ? (row.querySelector("button").textContent || "").trim() : null);
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

test("connected ethereum wallet survives reload", async ({
	page,
}, testInfo) => {
	await page.goto("/");
	const walletRow = walletsTable(page).getByRole("row", {
		name: MOCK_WALLETS.ethereum.wallet,
	});
	await walletRow.getByRole("button", { name: "Connect" }).click();
	await expect(
		walletRow.getByRole("button", { name: "Disconnect" }),
	).toBeVisible();

	await expect
		.poll(async () => JSON.stringify(await readPersistedState(page)))
		.toContain("Mock Ethereum Wallet");
	await saveJson(testInfo, "01-persisted", await readPersistedState(page));
	await snap(page, testInfo, "01-connected");

	await page.reload();
	await expect(
		walletRow.getByRole("button", { name: "Disconnect" }),
	).toBeVisible();
	await expect(
		accountsTable(page).getByRole("row", {
			name: MOCK_WALLETS.ethereum.account,
		}),
	).toBeVisible();
	await snap(page, testInfo, "02-after-reload");
});

test("a remembered polkadot wallet reads Connecting… until the extension answers, then Disconnect", async ({
	page,
}, testInfo) => {
	await page.addInitScript(BUTTON_RECORDER);
	await page.addInitScript(() => {
		(window as { __dotEnableDelayMs?: number }).__dotEnableDelayMs = 500;
	});
	await page.goto("/");
	const walletRow = walletsTable(page).getByRole("row", {
		name: MOCK_WALLETS.polkadot.wallet,
	});
	await walletRow.getByRole("button", { name: "Connect" }).click();
	await expect(
		walletRow.getByRole("button", { name: "Disconnect" }),
	).toBeVisible();
	await expect
		.poll(async () => JSON.stringify(await readPersistedState(page)))
		.toContain("mock-polkadot-wallet");

	await page.reload();
	await expect(
		walletRow.getByRole("button", { name: "Connecting…" }),
	).toBeDisabled();
	await snap(page, testInfo, "03-connecting");
	await expect(
		walletRow.getByRole("button", { name: "Disconnect" }),
	).toBeVisible();

	const labels = await labelSequence(page);
	await saveJson(testInfo, "04-button-labels", labels);
	expect(labels).toEqual(["Connecting…", "Disconnect"]);
	await snap(page, testInfo, "05-reconnected");
});
