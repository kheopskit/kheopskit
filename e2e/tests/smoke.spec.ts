import { expect, test } from "../fixtures";

test("renders the playground without console errors", async ({ page }) => {
	await page.goto("/");

	await expect(
		page.getByRole("heading", { name: /Kheopskit Playground/ }),
	).toBeVisible();

	// All four demo blocks are present (identified by their unique descriptions)
	await expect(
		page.getByText("Lists all wallets installed on your browser"),
	).toBeVisible();
	await expect(page.getByText("Lists all connected accounts")).toBeVisible();
	await expect(
		page.getByText("Demo transfer: selected account will send 0 tokens"),
	).toBeVisible();
	await expect(
		page.getByText("Connecting a wallet with Kheopskit makes it available"),
	).toBeVisible();
});

test("discovers the mock wallets", async ({ page }) => {
	await page.goto("/");

	const walletsTable = page
		.getByRole("table")
		.filter({ has: page.getByRole("columnheader", { name: "Accounts" }) });

	const ethRow = walletsTable.getByRole("row", {
		name: /Mock Ethereum Wallet/,
	});
	await expect(ethRow).toBeVisible();
	await expect(ethRow).toContainText("ethereum");
	await expect(ethRow.getByRole("button", { name: "Connect" })).toBeVisible();

	const dotRow = walletsTable.getByRole("row", {
		name: /mock-polkadot-wallet/,
	});
	await expect(dotRow).toBeVisible();
	await expect(dotRow).toContainText("polkadot");
	await expect(dotRow.getByRole("button", { name: "Connect" })).toBeVisible();

	const solRow = walletsTable.getByRole("row", {
		name: /Mock Solana Wallet/,
	});
	await expect(solRow).toBeVisible();
	await expect(solRow).toContainText("solana");
	await expect(solRow.getByRole("button", { name: "Connect" })).toBeVisible();
});
