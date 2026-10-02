import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const APPS = {
	"vite-react": {
		port: 4201,
		command:
			"pnpm --filter vite-react exec vite preview --port 4201 --strictPort",
	},
	"nextjs-react": {
		port: 4202,
		command: "pnpm --filter nextjs-react exec next start -p 4202",
	},
	"tanstack-start": {
		port: 4203,
		command:
			"pnpm --filter tanstack-start exec vite preview --port 4203 --strictPort",
	},
} as const;

type AppName = keyof typeof APPS;

const app = process.env.VERIFY_APP as AppName | undefined;
const spec = process.env.VERIFY_SPEC;
const evidenceDir = process.env.VERIFY_EVIDENCE_DIR;

if (!app || !(app in APPS) || !spec || !evidenceDir)
	throw new Error("Run through .claude/skills/verify/scripts/run.sh");

const { port, command } = APPS[app];

export default defineConfig({
	testDir: path.dirname(spec),
	testMatch: path.basename(spec),
	outputDir: path.join(evidenceDir, "artifacts"),
	workers: 1,
	retries: 0,
	reporter: [
		["list"],
		["json", { outputFile: path.join(evidenceDir, "report.json") }],
	],
	use: {
		trace: "on",
		screenshot: "on",
	},
	projects: [
		{
			name: app,
			use: {
				...devices["Desktop Chrome"],
				baseURL: `http://localhost:${port}`,
			},
		},
	],
	webServer: {
		command,
		port,
		cwd: path.join(__dirname, "../../.."),
		reuseExistingServer: false,
		timeout: 60_000,
	},
});
