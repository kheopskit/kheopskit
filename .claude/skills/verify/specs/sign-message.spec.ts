import {
	accountsTable,
	expect,
	MOCK_WALLETS,
	snap,
	test,
	walletsTable,
} from "../helpers";

const EXPECTED_SIGNATURE = {
	polkadot: /Signature: 0x(22){64}/,
	ethereum: /Signature: 0x(11){65}/,
	solana: /Signature: 1{64}/,
} as const;

for (const platform of ["polkadot", "ethereum", "solana"] as const) {
	test(`${platform}: connect, sign message, disconnect`, async ({
		page,
	}, testInfo) => {
		await page.goto("/");
		await expect(
			page.getByRole("heading", { name: /Kheopskit Playground/ }),
		).toBeVisible();

		const walletRow = walletsTable(page).getByRole("row", {
			name: MOCK_WALLETS[platform].wallet,
		});
		await walletRow.getByRole("button", { name: "Connect" }).click();
		await expect(
			walletRow.getByRole("button", { name: "Disconnect" }),
		).toBeVisible();

		const accountRow = accountsTable(page).getByRole("row", {
			name: MOCK_WALLETS[platform].account,
		});
		await expect(accountRow).toContainText(platform);
		const sign = accountRow.getByRole("button", { name: "Sign" });
		await expect(sign).toBeEnabled();
		await snap(page, testInfo, "01-connected");

		await sign.click();
		await expect(
			page.getByText(EXPECTED_SIGNATURE[platform]).first(),
		).toBeVisible();
		await snap(page, testInfo, "02-signed");

		await walletRow.getByRole("button", { name: "Disconnect" }).click();
		await expect(accountRow).not.toBeVisible();
		await snap(page, testInfo, "03-disconnected");
	});
}
