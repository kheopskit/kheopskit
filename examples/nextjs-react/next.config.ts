import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	transpilePackages: ["@kheopskit/core", "@kheopskit/react"],
	experimental: {
		optimizePackageImports: ["lucide-react"],
	},
};

export default nextConfig;
