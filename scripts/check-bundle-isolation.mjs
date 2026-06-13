#!/usr/bin/env node

/**
 * Guards the v4 promise that a dapp only bundles the SDKs for the platforms it
 * imports. Scans the built ESM entry bundles for forbidden cross-platform peer
 * deps. Run after `pnpm -F @kheopskit/core build`.
 *
 * It checks for bare import/require specifiers (e.g. `from "viem"`) rather than
 * substrings, so a comment or string mentioning a package name won't trip it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "packages", "core", "dist");

// Per entry: the peer-dep packages that must NOT appear in that bundle.
const RULES = {
	"index.mjs": [
		"viem",
		"mipd",
		"@solana/kit",
		"@wallet-standard/app",
		"polkadot-api",
	],
	"polkadot.mjs": ["viem", "mipd", "@solana/kit", "@wallet-standard/app"],
	"ethereum.mjs": ["@solana/kit", "@wallet-standard/app", "polkadot-api"],
	"solana.mjs": ["viem", "mipd", "polkadot-api"],
};

// Bundle chunks reachable from an entry, resolved by following relative imports.
const importedChunks = (entry, seen = new Set()) => {
	if (seen.has(entry)) return seen;
	seen.add(entry);
	let source;
	try {
		source = readFileSync(join(distDir, entry), "utf-8");
	} catch {
		return seen;
	}
	const re = /(?:from|import|require\()\s*["']([^"']+)["']/g;
	for (const [, spec] of source.matchAll(re)) {
		if (spec.startsWith(".")) {
			const file = spec.replace(/^\.\//, "");
			importedChunks(file.endsWith(".mjs") ? file : `${file}.mjs`, seen);
		}
	}
	return seen;
};

const bareSpecifiers = (source) => {
	const specs = new Set();
	const re = /(?:from|import|require\()\s*["']([^"']+)["']/g;
	for (const [, spec] of source.matchAll(re)) {
		if (!spec.startsWith(".")) specs.add(spec);
	}
	return specs;
};

const matchesPkg = (spec, pkg) => spec === pkg || spec.startsWith(`${pkg}/`);

let failed = false;
const dist = (() => {
	try {
		return readdirSync(distDir);
	} catch {
		return [];
	}
})();

if (!dist.includes("index.mjs")) {
	console.error(
		"[check:isolation] No built bundles found. Run `pnpm -F @kheopskit/core build` first.",
	);
	process.exit(1);
}

for (const [entry, forbidden] of Object.entries(RULES)) {
	const chunks = importedChunks(entry);
	const found = new Set();
	for (const chunk of chunks) {
		let source;
		try {
			source = readFileSync(join(distDir, chunk), "utf-8");
		} catch {
			continue;
		}
		for (const spec of bareSpecifiers(source)) {
			for (const pkg of forbidden) {
				if (matchesPkg(spec, pkg)) found.add(pkg);
			}
		}
	}
	if (found.size > 0) {
		failed = true;
		console.error(
			`[check:isolation] ❌ ${entry} bundles forbidden peer dep(s): ${[...found].join(", ")}`,
		);
	} else {
		console.log(`[check:isolation] ✅ ${entry} is isolated`);
	}
}

if (failed) {
	console.error("[check:isolation] bundle isolation check FAILED");
	process.exit(1);
}
console.log("[check:isolation] all entry bundles are isolated");
