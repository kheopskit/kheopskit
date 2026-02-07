import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: ["./vitest.setup.ts"],
		include: ["packages/**/*.test.ts", "packages/**/*.test.tsx"],
		coverage: {
			provider: "v8",
			include: ["packages/*/src/**"],
		},
	},
});
