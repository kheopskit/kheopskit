#!/usr/bin/env node

/**
 * Guards the v4 promise that a dapp only bundles the SDKs for the platforms it
 * imports. Scans the built entry bundles — both ESM (.mjs) and CJS (.js) — for
 * forbidden cross-platform peer deps. Run after `pnpm -F @kheopskit/core build`.
 *
 * It checks for bare import/require specifiers (e.g. `from "viem"` /
 * `require("viem")`) rather than substrings, so a comment or string mentioning
 * a package name won't trip it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "packages", "core", "dist");

// Per logical entry: the peer-dep packages that must NOT appear in its bundle.
const RULES = {
	index: [
		"viem",
		"mipd",
		"@solana/kit",
		"@wallet-standard/app",
		"polkadot-api",
	],
	polkadot: ["viem", "mipd", "@solana/kit", "@wallet-standard/app"],
	ethereum: ["@solana/kit", "@wallet-standard/app", "polkadot-api"],
	solana: ["viem", "mipd", "polkadot-api"],
};

// Both distributed formats must be isolated, not just ESM.
const FORMATS = [".mjs", ".js"];

const SPEC_RE = /(?:from|import|require\()\s*["']([^"']+)["']/g;

// Bundle chunks reachable from an entry, resolved by following relative imports.
// Specifiers in built output carry their extension (.mjs / .js), so follow them
// literally rather than assuming a format.
const importedChunks = (entry, seen = new Set()) => {
	if (seen.has(entry)) return seen;
	seen.add(entry);
	let source;
	try {
		source = readFileSync(join(distDir, entry), "utf-8");
	} catch {
		return seen;
	}
	for (const [, spec] of source.matchAll(SPEC_RE)) {
		if (spec.startsWith(".")) importedChunks(spec.replace(/^\.\//, ""), seen);
	}
	return seen;
};

const bareSpecifiers = (source) => {
	const specs = new Set();
	for (const [, spec] of source.matchAll(SPEC_RE)) {
		if (!spec.startsWith(".")) specs.add(spec);
	}
	return specs;
};

const matchesPkg = (spec, pkg) => spec === pkg || spec.startsWith(`${pkg}/`);

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

let failed = false;
let checked = 0;

for (const [name, forbidden] of Object.entries(RULES)) {
	for (const fmt of FORMATS) {
		const entry = `${name}${fmt}`;
		if (!dist.includes(entry)) continue;
		checked++;
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
}

if (failed) {
	console.error("[check:isolation] bundle isolation check FAILED");
	process.exit(1);
}
console.log(`[check:isolation] all ${checked} entry bundles are isolated`);
