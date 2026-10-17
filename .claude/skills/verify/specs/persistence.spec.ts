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

// Samples the Ethereum row's button label on every animation frame: the
// reconnect window after a reload is shorter than a locator poll (the recorder
// pattern from e2e/tests/no-flicker.spec.ts).
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

test("connected ethereum wallet survives reload", async ({
	page,
}, testInfo) => {
	await page.addInitScript(BUTTON_RECORDER);
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
	const labels = await labelSequence(page);
	await saveJson(testInfo, "02-button-labels", labels);
	expect(labels).toEqual(["Connecting…", "Disconnect"]);
	await snap(page, testInfo, "02-after-reload");
});
