import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import biomePlugin from "vite-plugin-biome";
import tsconfigPaths from "vite-tsconfig-paths";

// https://vite.dev/config/
export default defineConfig({
	// biome-ignore lint: biomePlugin type mismatch with latest vite
	plugins: [react(), tailwindcss(), biomePlugin() as any, tsconfigPaths()],
	server: {
		port: 3001,
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
