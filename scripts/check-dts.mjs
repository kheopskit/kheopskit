#!/usr/bin/env node

/**
 * Guards the published type declarations. Run after `pnpm build:packages`, and
 * before publishing.
 *
 * Why this exists: `@kheopskit/react@5.1.1` shipped a `dist/index.d.mts` where
 * `useAccounts()` returned `any` and `useWallets()` referenced identifiers that
 * were never declared (`P_1`, an unaliased `KheopskitState`). react's
 * declaration emit resolves `@kheopskit/core` to core's *built* dist (see
 * packages/react/tsconfig.build.json `"paths": {}`), and when that dist is
 * missing or half-written the emit degrades every type it cannot resolve to
 * `any` and exits 0. Nothing in either package's own build or typecheck sees
 * it: react's `tsc --noEmit` maps `@kheopskit/core` back to core's sources, and
 * widening to `any` compiles fine everywhere. It only surfaces downstream.
 *
 * Three checks:
 *
 * 1. every declaration file the packages' `exports` maps point at exists;
 * 2. neither package rebuilds during `pnpm publish` — see NO_BUILD_ON_PACK;
 * 3. a fixture consuming the built declarations type-checks and asserts the
 *    public hooks are not `any` (see scripts/dts-guard/).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const PACKAGES = ["core", "react"];

/**
 * `changeset publish` spawns `pnpm publish` for every package concurrently, and
 * `pnpm publish` runs these lifecycle scripts. A build in any of them therefore
 * runs core's `tsdown` (which cleans core/dist) at the same time as react's
 * declaration emit reads it — exactly how 5.1.1 was produced. Packages are
 * built once, up front, by `pnpm build:packages`.
 */
const NO_BUILD_ON_PACK = ["prepack", "prepare", "prepublishOnly"];

const label = "[check:dts]";

let failed = false;

const fail = (message) => {
	failed = true;
	console.error(`${label} ❌ ${message}`);
};

/** Every `"types"` target in an `exports` map, plus the legacy `types` field. */
const declarationTargets = (packageJson) => {
	const targets = new Set();
	if (typeof packageJson.types === "string") targets.add(packageJson.types);

	const walk = (node, key) => {
		if (typeof node === "string") {
			if (key === "types") targets.add(node);
			return;
		}
		if (node && typeof node === "object")
			for (const [k, v] of Object.entries(node)) walk(v, k);
	};
	walk(packageJson.exports, undefined);

	return targets;
};

let checkedFiles = 0;

for (const name of PACKAGES) {
	const packageDir = join(root, "packages", name);
	const packageJson = JSON.parse(
		readFileSync(join(packageDir, "package.json"), "utf-8"),
	);

	const targets = declarationTargets(packageJson);
	if (targets.size === 0)
		fail(`${packageJson.name} declares no type entry points`);

	for (const target of targets) {
		if (existsSync(join(packageDir, target))) checkedFiles++;
		else fail(`${packageJson.name} is missing ${target} — build first`);
	}

	for (const script of NO_BUILD_ON_PACK) {
		if (packageJson.scripts?.[script])
			fail(
				`${packageJson.name} defines a "${script}" script (${packageJson.scripts[script]}). ` +
					"pnpm publish runs it for every package concurrently, which races core's " +
					"build against react's declaration emit. Build via `pnpm build:packages` instead.",
			);
	}
}

if (!failed)
	console.log(`${label} ✅ ${checkedFiles} declaration entry points present`);

const project = join(__dirname, "dts-guard", "tsconfig.json");
const tsc = join(root, "node_modules", ".bin", "tsc");

console.log(`${label} type-checking dist declarations as a consumer would…`);
const { status, error } = spawnSync(tsc, ["-p", project], {
	cwd: root,
	stdio: "inherit",
});

if (error) fail(`could not run tsc: ${error.message}`);
else if (status !== 0)
	fail(
		"the built declarations do not type-check as a consumer sees them — " +
			"generic account/wallet types are broken or collapsed to `any`",
	);
else console.log(`${label} ✅ built declarations are correctly typed`);

if (failed) {
	console.error(`${label} type declaration check FAILED`);
	process.exit(1);
}
console.log(`${label} all type declaration checks passed`);
