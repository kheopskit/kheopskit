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
 * Two checks:
 *
 * 1. neither package rebuilds during `pnpm publish` — see NO_BUILD_ON_PACK;
 * 2. a fixture consuming the built declarations type-checks (scripts/dts-guard/).
 *
 * TODO: delete this once rolldown-plugin-dts reports unresolvable types itself.
 * As of rolldown-plugin-dts@0.27.12 the emit substitutes `any`, prints no
 * warning at all and exits 0, so `failOnWarn` has nothing to act on. Its
 * `dts: { resolver: "tsc" }` mode would surface the real TS2307, but crashes on
 * typescript@7.0.2 with `ts.parseJsonConfigFileContent is not a function`. When
 * that resolver works, tsc fails the build on its own and this check is
 * redundant.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

for (const name of PACKAGES) {
	const packageJson = JSON.parse(
		readFileSync(join(root, "packages", name, "package.json"), "utf-8"),
	);

	for (const script of NO_BUILD_ON_PACK) {
		if (packageJson.scripts?.[script])
			fail(
				`${packageJson.name} defines a "${script}" script (${packageJson.scripts[script]}). ` +
					"pnpm publish runs it for every package concurrently, which races core's " +
					"build against react's declaration emit. Build via `pnpm build:packages` instead.",
			);
	}
}

console.log(`${label} type-checking dist declarations as a consumer would…`);
const { status, error } = spawnSync(
	join(root, "node_modules", ".bin", "tsc"),
	["-p", join(__dirname, "dts-guard", "tsconfig.json")],
	{ cwd: root, stdio: "inherit" },
);

if (error) fail(`could not run tsc: ${error.message}`);
else if (status !== 0)
	fail(
		"the built declarations do not type-check as a consumer sees them — " +
			"missing, referencing undeclared types, or collapsed to `any`. " +
			"Rebuild with `pnpm build:packages` and check the errors above.",
	);

if (failed) {
	console.error(`${label} type declaration check FAILED`);
	process.exit(1);
}
console.log(`${label} ✅ published declarations are sound`);
