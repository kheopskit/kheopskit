import path from "node:path";
import { test as base, expect } from "@playwright/test";

const MOCK_WALLETS_SCRIPT = path.join(__dirname, "mocks", "mock-wallets.js");

type Fixtures = {
	/** Console/page errors collected during the test. Asserted empty on teardown. */
	consoleErrors: string[];
};

export const test = base.extend<Fixtures>({
	consoleErrors: [
		async ({ page }, use) => {
			const errors: string[] = [];

			page.on("pageerror", (error) => {
				errors.push(`pageerror: ${error.message}`);
			});
			page.on("console", (message) => {
				if (message.type() === "error") {
					errors.push(`console.error: ${message.text()}`);
				}
			});

			await use(errors);

			expect(errors, "no console errors during the test").toEqual([]);
		},
		{ auto: true },
	],

	page: async ({ page }, use) => {
		await page.addInitScript({ path: MOCK_WALLETS_SCRIPT });
		await use(page);
	},
});

export { expect };
