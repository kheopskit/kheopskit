import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

// The Wallets and Accounts tables both contain the wallet name, so rows must
// be scoped to their table. Tables are identified by a unique column header.
const getWalletsTable = (page: Page) =>
	page
		.getByRole("table")
		.filter({ has: page.getByRole("columnheader", { name: "Accounts" }) });

const getAccountsTable = (page: Page) =>
	page
		.getByRole("table")
		.filter({ has: page.getByRole("columnheader", { name: "Address" }) });

test.describe("ethereum mock wallet", () => {
	test("connect, list account, sign message, disconnect", async ({ page }) => {
		await page.goto("/");

		const walletRow = getWalletsTable(page).getByRole("row", {
			name: /Mock Ethereum Wallet/,
		});
		await walletRow.getByRole("button", { name: "Connect" }).click();

		// Wallet row flips to connected state and reports one account
		await expect(
			walletRow.getByRole("button", { name: "Disconnect" }),
		).toBeVisible();
		await expect(
			walletRow.getByRole("cell", { name: "1", exact: true }),
		).toBeVisible();

		// Account appears in the Accounts table with its chain id
		const accountRow = getAccountsTable(page).getByRole("row", {
			name: /Mock Ethereum Wallet/,
		});
		await expect(accountRow).toBeVisible();
		await expect(accountRow).toContainText("ethereum");
		await expect(
			accountRow.getByRole("cell", { name: "1", exact: true }),
		).toBeVisible(); // chainId from eth_chainId

		// Sign goes through viem walletClient -> personal_sign on the provider
		await accountRow.getByRole("button", { name: "Sign" }).click();
		await expect(page.getByText(/Signature: 0x11/).first()).toBeVisible();

		// Disconnect removes the account
		await walletRow.getByRole("button", { name: "Disconnect" }).click();
		await expect(
			walletRow.getByRole("button", { name: "Connect" }),
		).toBeVisible();
		await expect(accountRow).not.toBeVisible();
	});
});

test.describe("polkadot mock wallet", () => {
	test("connect, list account, sign bytes, disconnect", async ({ page }) => {
		await page.goto("/");

		const walletRow = getWalletsTable(page).getByRole("row", {
			name: /mock-polkadot-wallet/,
		});
		await walletRow.getByRole("button", { name: "Connect" }).click();

		await expect(
			walletRow.getByRole("button", { name: "Disconnect" }),
		).toBeVisible();
		await expect(
			walletRow.getByRole("cell", { name: "1", exact: true }),
		).toBeVisible();

		// Account appears with the name reported by the extension
		const accountRow = getAccountsTable(page).getByRole("row", {
			name: /Mock Account/,
		});
		await expect(accountRow).toBeVisible();
		await expect(accountRow).toContainText("polkadot");

		// Sign goes through papi pjs-signer -> signRaw on the mock extension
		await accountRow.getByRole("button", { name: "Sign" }).click();
		await expect(page.getByText(/Signature: 0x22/).first()).toBeVisible();

		await walletRow.getByRole("button", { name: "Disconnect" }).click();
		await expect(
			walletRow.getByRole("button", { name: "Connect" }),
		).toBeVisible();
		await expect(accountRow).not.toBeVisible();
	});
});

test.describe("solana mock wallet", () => {
	test("connect, list account, sign message, disconnect", async ({ page }) => {
		await page.goto("/");

		const walletRow = getWalletsTable(page).getByRole("row", {
			name: /Mock Solana Wallet/,
		});
		await walletRow.getByRole("button", { name: "Connect" }).click();

		await expect(
			walletRow.getByRole("button", { name: "Disconnect" }),
		).toBeVisible();
		await expect(
			walletRow.getByRole("cell", { name: "1", exact: true }),
		).toBeVisible();

		// Account appears, discovered via the Wallet Standard
		const accountRow = getAccountsTable(page).getByRole("row", {
			name: /Mock Solana Wallet/,
		});
		await expect(accountRow).toBeVisible();
		await expect(accountRow).toContainText("solana");

		// Sign goes through the Wallet Standard solana:signMessage feature; the
		// mock returns 64 zero bytes, which base58-encodes to "1" x 64.
		await accountRow.getByRole("button", { name: "Sign" }).click();
		await expect(page.getByText(/Signature: 1{20,}/).first()).toBeVisible();

		await walletRow.getByRole("button", { name: "Disconnect" }).click();
		await expect(
			walletRow.getByRole("button", { name: "Connect" }),
		).toBeVisible();
		await expect(accountRow).not.toBeVisible();
	});
});
