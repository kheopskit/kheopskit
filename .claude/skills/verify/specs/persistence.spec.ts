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
