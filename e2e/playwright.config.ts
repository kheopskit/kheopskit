import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Each example app is built for production and served on its own port.
// Run `pnpm test:e2e` from the repo root (builds first), or
// `pnpm exec playwright test -c e2e` if everything is already built.
const APPS = [
	{
		name: "vite-react",
		port: 4101,
		command:
			"pnpm --filter vite-react exec vite preview --port 4101 --strictPort",
	},
	{
		name: "nextjs-react",
		port: 4102,
		command: "pnpm --filter nextjs-react exec next start -p 4102",
	},
	{
		name: "tanstack-start",
		port: 4103,
		command:
			"pnpm --filter tanstack-start exec vite preview --port 4103 --strictPort",
	},
];

export default defineConfig({
	testDir: "./tests",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: process.env.CI
		? [["list"], ["html", { open: "never" }]]
		: [["list"]],
	use: {
		trace: "retain-on-failure",
	},
	projects: APPS.map((app) => ({
		name: app.name,
		use: {
			...devices["Desktop Chrome"],
			baseURL: `http://localhost:${app.port}`,
		},
	})),
	webServer: APPS.map((app) => ({
		command: app.command,
		port: app.port,
		cwd: path.join(__dirname, ".."),
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	})),
});
