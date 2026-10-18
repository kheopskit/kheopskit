import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

const MOCKS_DIR = path.join(__dirname, "..", "mocks");
const MAX_LOAD_TO_ROW_MS = 300;
const SUBSCRIBE_TAIL_READS = 5;
const LOAD_TAIL_MS = 1100;

type DiscoveryMarks = {
	registryReads: number[];
	dcl: number;
	injected: number;
	load: number;
	discoveringAtLoad: boolean;
	discoveringFirstSeen: number | null;
	discoveringGone: number | null;
	lateRowFirstSeen: number | null;
};

const readMarks = (page: Page): Promise<DiscoveryMarks> =>
	page.evaluate(
		() =>
			(window as unknown as { __discoveryMarks: DiscoveryMarks })
				.__discoveryMarks,
	);

const walletsTable = (page: Page) =>
	page
		.getByRole("table")
		.filter({ has: page.getByRole("columnheader", { name: "Accounts" }) });

test("a wallet injected after the subscribe reads but before load is listed at load, and discovery ends 1100 ms after load", async ({
	page,
}, testInfo) => {
	await page.addInitScript({ path: path.join(MOCKS_DIR, "mock-wallets.js") });
	await page.addInitScript({ path: path.join(MOCKS_DIR, "late-wallet.js") });
	await page.route(
		(url) =>
			url.pathname === "/kheopskit-square.svg" && url.search === "?hold-load",
		async (route) => {
			await page.waitForFunction(
				() =>
					(window as unknown as { __discoveryMarks: DiscoveryMarks })
						.__discoveryMarks.injected !== null,
			);
			await route.continue();
		},
	);

	await page.goto("/", { waitUntil: "commit" });
	const discovering = page.getByText("Looking for wallets…");
	await expect(discovering).toBeVisible();

	await page.waitForLoadState("load");
	const lateRow = walletsTable(page).getByRole("row", {
		name: /late-mock-wallet/,
	});
	await expect(lateRow).toBeVisible();
	await expect(discovering).toBeHidden();

	const marks = await readMarks(page);
	const subscribedAt = marks.registryReads[0] ?? Number.NaN;
	const lastRead = marks.registryReads.at(-1) ?? Number.NaN;
	const loadToRowMs = (marks.lateRowFirstSeen ?? Number.NaN) - marks.load;
	await testInfo.attach("discovery-timestamps.json", {
		body: JSON.stringify(
			{ ...marks, subscribedAt, lastRead, loadToRowMs },
			null,
			2,
		),
		contentType: "application/json",
	});
	console.log(
		`[${testInfo.project.name}] load-to-row ${loadToRowMs.toFixed(1)} ms; subscribe ${subscribedAt.toFixed(1)}, injected ${marks.injected.toFixed(1)}, load ${marks.load.toFixed(1)}, row ${marks.lateRowFirstSeen?.toFixed(1)}, reads after load ${marks.registryReads
			.filter((read) => read >= marks.load)
			.map((read) => (read - marks.load).toFixed(1))
			.join(" ")}, status hidden ${marks.discoveringGone?.toFixed(1)}`,
	);

	expect(
		marks.registryReads[SUBSCRIBE_TAIL_READS - 1],
		"subscribe reads finished before the injection",
	).toBeLessThan(marks.injected);
	expect(marks.injected, "injected before load").toBeLessThan(marks.load);
	expect(marks.discoveringAtLoad, "status shown until load").toBe(true);
	expect(
		lastRead - marks.load,
		"registry read until 1100 ms after load",
	).toBeGreaterThanOrEqual(LOAD_TAIL_MS);
	expect(
		marks.discoveringGone,
		"status hidden after the last read",
	).toBeGreaterThan(lastRead);
	expect(marks.lateRowFirstSeen, "row absent before load").toBeGreaterThan(
		marks.load,
	);
	expect(loadToRowMs, "row listed soon after load").toBeLessThanOrEqual(
		MAX_LOAD_TO_ROW_MS,
	);
});
