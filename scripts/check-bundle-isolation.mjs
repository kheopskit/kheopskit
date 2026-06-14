#!/usr/bin/env node

/**
 * Guards the v4 promise that a dapp only bundles the SDKs for the platforms it
 * imports. Scans the built entry bundles for forbidden cross-platform peer
 * deps, across BOTH runtime output (ESM .mjs + CJS .js) and published type
 * definitions (.d.ts + .d.mts) — so a Polkadot-only dapp pulls no other
 * platform's SDK into its bundle OR its type-check. Run after
 * `pnpm -F @kheopskit/core build`.
 *
 * It matches bare import/require specifiers (e.g. `from "viem"` /
 * `require("viem")`) rather than substrings, so a comment or string mentioning
 * a package name won't trip it.
 *
 * Dynamic imports: a guarded `await import("pkg")` (e.g. @reown/appkit) is a
 * lazy boundary a tree-shaking dapp bundler keeps out of the eager graph. In
 * ESM output it stays `import("pkg")` and is intentionally NOT matched by the
 * runtime pass. tsup lowers it to `require("pkg")` in CJS output, which is
 * indistinguishable from a static require — so only packages that are *always*
 * statically imported belong in RULES (the per-platform SDKs are; @reown/appkit,
 * loaded dynamically and shared across platforms, deliberately is not).
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "packages", "core", "dist");

// Per logical entry: the peer-dep packages that must NOT appear in its bundle
// or its type definitions.
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

// Runtime bundle formats and the matching type-definition formats. Both must be
// isolated, not just ESM.
const RUNTIME_FORMATS = [".mjs", ".js"];
const DTS_FORMATS = [".d.ts", ".d.mts"];

// Static specifiers only: `import ... from "x"`, side-effect `import "x"`, and
// `require("x")`. Excludes dynamic `import("x")` (lazy in ESM). Used for both
// runtime chunk traversal and runtime leak detection.
const STATIC_SPEC_RES = [
	/\bfrom\s*["']([^"']+)["']/g,
	/\bimport\s*["']([^"']+)["']/g,
	/\brequire\(\s*["']([^"']+)["']/g,
];

// Type-definition specifiers: the static forms plus inline `import("x")` type
// references, which in a .d.ts are ordinary type deps, not lazy boundaries.
const DTS_SPEC_RES = [...STATIC_SPEC_RES, /\bimport\s*\(\s*["']([^"']+)["']/g];

const specifiers = (source, regexes) => {
	const specs = new Set();
	for (const re of regexes)
		for (const [, spec] of source.matchAll(re)) specs.add(spec);
	return specs;
};

const isRelative = (spec) => spec.startsWith(".");
const matchesPkg = (spec, pkg) => spec === pkg || spec.startsWith(`${pkg}/`);

const readDist = (file) => {
	try {
		return readFileSync(join(distDir, file), "utf-8");
	} catch {
		return null;
	}
};

// Resolve a relative runtime specifier (./foo.mjs / ./foo.js) to its file.
const resolveRuntime = (spec) => spec.replace(/^\.\//, "");

// Resolve a relative type specifier to its sibling .d.ts/.d.mts: declaration
// files import runtime extensions (./foo.js / ./foo.mjs) that don't exist on
// disk, so remap them to the matching declaration file.
const resolveDts = (spec) =>
	spec
		.replace(/^\.\//, "")
		.replace(/\.mjs$/, ".d.mts")
		.replace(/\.js$/, ".d.ts");

// Chunks reachable from an entry by following relative imports of the given
// kind, resolved with `resolveSpec`.
const reachableChunks = (entry, regexes, resolveSpec, seen = new Set()) => {
	if (seen.has(entry)) return seen;
	seen.add(entry);
	const source = readDist(entry);
	if (source === null) return seen;
	for (const spec of specifiers(source, regexes)) {
		if (isRelative(spec))
			reachableChunks(resolveSpec(spec), regexes, resolveSpec, seen);
	}
	return seen;
};

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

const checkEntry = (entry, forbidden, regexes, resolveSpec) => {
	const chunks = reachableChunks(entry, regexes, resolveSpec);
	const found = new Set();
	for (const chunk of chunks) {
		const source = readDist(chunk);
		if (source === null) continue;
		for (const spec of specifiers(source, regexes)) {
			if (isRelative(spec)) continue;
			for (const pkg of forbidden) {
				if (matchesPkg(spec, pkg)) found.add(pkg);
			}
		}
	}
	checked++;
	if (found.size > 0) {
		failed = true;
		console.error(
			`[check:isolation] ❌ ${entry} leaks forbidden peer dep(s): ${[...found].join(", ")}`,
		);
	} else {
		console.log(`[check:isolation] ✅ ${entry} is isolated`);
	}
};

for (const [name, forbidden] of Object.entries(RULES)) {
	for (const fmt of RUNTIME_FORMATS) {
		const entry = `${name}${fmt}`;
		if (dist.includes(entry))
			checkEntry(entry, forbidden, STATIC_SPEC_RES, resolveRuntime);
	}
	for (const fmt of DTS_FORMATS) {
		const entry = `${name}${fmt}`;
		if (dist.includes(entry))
			checkEntry(entry, forbidden, DTS_SPEC_RES, resolveDts);
	}
}

if (failed) {
	console.error("[check:isolation] bundle isolation check FAILED");
	process.exit(1);
}
console.log(`[check:isolation] all ${checked} entry bundles are isolated`);
