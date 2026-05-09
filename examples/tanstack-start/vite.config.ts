import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	plugins: [tanstackStart(), react(), tailwindcss(), tsConfigPaths()],
	ssr: {
		// Handle lodash CommonJS module in SSR
		noExternal: ["lodash"],
	},
	build: {
		rolldownOptions: {
			output: {
				// Prevent Rolldown from splitting viem across chunks,
				// which creates circular dependencies that break class inheritance at runtime
				codeSplitting: {
					groups: [
						{
							name: "viem",
							test: /node_modules\/viem\//,
						},
					],
				},
			},
		},
	},
});
