import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

const MOCK_WALLETS_SCRIPT = path.join(
	__dirname,
	"..",
	"mocks",
	"mock-wallets.js",
);

const persistedBackends = (page: Page) =>
	page.evaluate(() => {
		const cookie = document.cookie
			.split("; ")
			.find((entry) => entry.startsWith("kheopskit="));
		const compact = cookie
			? JSON.parse(decodeURIComponent(cookie.slice("kheopskit=".length)))
			: {};
		return {
			cookieRemembered: compact.r ?? [],
			localStorage: localStorage.getItem("kheopskit"),
		};
	});

test("an SSR app persists a connect to the cookie, not localStorage", async ({
	page,
}, testInfo) => {
	test.skip(
		testInfo.project.name === "vite-react",
		"vite-react renders on the client only and persists to localStorage",
	);
	await page.addInitScript({ path: MOCK_WALLETS_SCRIPT });
	await page.goto("/");
	const row = page
		.getByRole("table")
		.filter({ has: page.getByRole("columnheader", { name: "Accounts" }) })
		.getByRole("row", { name: /mock-polkadot-wallet/ });

	await row.getByRole("button", { name: "Connect" }).click();
	await expect(row.getByRole("button", { name: "Disconnect" })).toBeVisible();

	await expect
		.poll(() => persistedBackends(page), { timeout: 15_000 })
		.toEqual({
			cookieRemembered: ["polkadot:mock-polkadot-wallet"],
			localStorage: null,
		});
});
