import { expect, MOCK_WALLETS, snap, test, walletsTable } from "../helpers";

test("discovery rows", async ({ page }, testInfo) => {
	await page.goto("/");
	for (const p of ["polkadot", "ethereum", "solana"] as const) {
		const row = walletsTable(page).getByRole("row", {
			name: MOCK_WALLETS[p].wallet,
		});
		await expect(row).toContainText(p);
		await expect(
			row.getByRole("cell", { name: "0", exact: true }),
		).toBeVisible();
	}
	const wc = walletsTable(page).getByRole("row", { name: /WalletConnect/ });
	await expect(wc.getByRole("cell").first()).toHaveText("—");
	await snap(page, testInfo, "01-discovered");
});

test("wagmi sign", async ({ page }, testInfo) => {
	await page.goto("/");
	const row = walletsTable(page).getByRole("row", {
		name: MOCK_WALLETS.ethereum.wallet,
	});
	await row.getByRole("button", { name: "Connect" }).click();
	await expect(row.getByRole("button", { name: "Disconnect" })).toBeVisible();
	await expect(
		page.getByText(
			"Active account: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
		),
	).toBeVisible();
	const card = page
		.locator("div", { has: page.getByText("Best practice with Kheopskit") })
		.last();
	await card.getByRole("combobox").click();
	await page
		.getByRole("option", { name: /Mock Ethereum Wallet - 0xf39F/ })
		.click();
	const sign = card.getByRole("button", { name: "Sign" });
	await expect(sign).toBeEnabled();
	await snap(page, testInfo, "01-picked");
	await sign.click();
	await expect(page.getByText(/Signature: 0x(11){65}/).first()).toBeVisible();
	await snap(page, testInfo, "02-signed");
});
