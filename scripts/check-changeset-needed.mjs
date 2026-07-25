#!/usr/bin/env node

/**
 * Fails a pull request that changes a published package without adding a
 * changeset that actually releases it.
 *
 * "Changes a published package" means anything that alters what npm consumers
 * would get: the source that `dist` is built from, the files listed in `files`,
 * the build configuration — including the shared one at the repository root —
 * and the manifest itself. Two manifest fields are deliberately excluded:
 *
 *   - `version`, which Changesets owns.
 *   - `devDependencies`, which npm publishes but never installs for consumers.
 *     Requiring a changeset for every Dependabot devDep bump is the failure
 *     mode this gate exists to avoid: a check that fails on nearly every PR is
 *     one everybody learns to bypass. This holds only while no devDep-only
 *     package reaches the build output — today every such import in
 *     packages/core is `import type` and none appear in the emitted `.d.ts`, so
 *     a bump cannot change a published byte. A future *value* import of a
 *     devDep would be bundled into `dist` and would break that assumption.
 *
 * Everything else a dependency PR usually touches — the lockfile, examples,
 * workflows, tests — leaves the published artifact byte-identical.
 *
 * The check keys off the diff rather than the PR author or the Dependabot
 * group name, so a dependency added later is covered without touching any
 * config. A new published package is the one exception: it must be added to
 * `PACKAGES` below, or the gate never sees it.
 *
 * Coverage is decided by Changesets itself rather than by looking at filenames:
 * `changeset status` applies the real ignore/fixed rules, so a dot-prefixed
 * file, an `--empty` changeset, or one naming only an ignored example is
 * correctly seen as releasing nothing. The gate additionally requires the
 * release to be driven by a changeset *this branch added*, so an unrelated
 * changeset already sitting on the base branch cannot silently cover a change
 * that would then ship with no changelog entry.
 *
 * Run on pull requests only, and skip the Changesets release PR — it rewrites
 * peerDependencies via `sync-peer-deps` while deleting the changesets it
 * consumed.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const BASE = process.env.BASE_REF ?? "origin/main";
const PACKAGES = ["packages/core", "packages/react"];

/**
 * Build inputs that live outside the packages yet reach their output: both
 * `tsconfig.build.json` files extend this one, so a `target` or `importHelpers`
 * change here rewrites the emitted JavaScript and `.d.ts` of packages whose own
 * files never moved.
 *
 * The lockfile is deliberately absent: tsdown externalises `dependencies` and
 * `peerDependencies`, so a resolution change cannot alter a published byte, and
 * a gate that fires on every dependency PR is one everybody learns to bypass.
 * This knowingly waves through toolchain bumps — a new `typescript` or `tsdown`
 * resolution rewrites the emitted `dist` and `.d.ts` even though no gated file
 * moved. Accepted: gating the lockfile would reintroduce the fires-on-every-PR
 * failure mode for a class of change that is cosmetic in practice.
 * The per-package tsdown config needs no entry either — it lives in the
 * manifest, which is compared in full.
 */
const SHARED_BUILD_INPUTS = ["tsconfig.base.json"];

/** Owned by Changesets, or published but inert for consumers. */
const UNPUBLISHED_FIELDS = ["version", "devDependencies"];

/**
 * Fields whose nesting is order-sensitive. Node walks `exports` and `imports`
 * in declaration order and takes the first condition that matches, so moving
 * `default` above `types` changes what consumers resolve while every key and
 * value stays the same.
 */
const ORDERED_FIELDS = ["exports", "imports"];

/**
 * Tracked under a published package, yet cannot reach the npm tarball:
 * CHANGELOG.md is written by Changesets during the release itself, tests are
 * never built into `dist`, and the tsbuildinfo is a local build cache.
 */
const IRRELEVANT = [
	/(^|\/)CHANGELOG\.md$/,
	/\.test\.[cm]?tsx?$/,
	/(^|\/)tsconfig\.tsbuildinfo$/,
];

/**
 * Key order carries no meaning to npm, so a reformat must not read as a real
 * change. Arrays are left alone: `files` and `keywords` are unordered in
 * practice but rarely shuffled, whereas an `exports` fallback array is strictly
 * ordered — sorting would buy nothing and hide a real change.
 */
const sortKeys = (value) => {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, sortKeys(value[key])]),
	);
};

/**
 * The part of a manifest that consumers can observe. Comparing everything but
 * the two excluded fields means new fields are covered by default — `exports`,
 * `files`, `engines` and the `tsdown` build config all change the published
 * package, and none of them need to be enumerated here to be caught.
 */
export const publishedManifest = (pkg) =>
	JSON.stringify(
		Object.fromEntries(
			Object.entries(pkg)
				.filter(([field]) => !UNPUBLISHED_FIELDS.includes(field))
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([field, value]) => [
					field,
					ORDERED_FIELDS.includes(field) ? value : sortKeys(value),
				]),
		),
	);

/**
 * Whether a changed path feeds the published artifact. package.json is
 * excluded because it is compared field-wise instead — a devDependency bump
 * shows up as a changed file but not as a changed package.
 */
export const affectsPublishedArtifact = (file) =>
	SHARED_BUILD_INPUTS.includes(file) ||
	(PACKAGES.some((dir) => file.startsWith(`${dir}/`)) &&
		!file.endsWith("/package.json") &&
		!IRRELEVANT.some((pattern) => pattern.test(file)));

/**
 * Given a Changesets release plan, the ids of changesets that drive a real
 * release, and whether the published packages are among what gets released.
 * Ignored packages surface as `type: "none"`, so filtering on that is what
 * makes an example-only changeset correctly count for nothing.
 */
export const planCoverage = (plan, publishedNames) => {
	const releasing = (plan?.releases ?? []).filter((r) => r.type !== "none");
	return {
		releasesPublished: releasing.some((r) => publishedNames.includes(r.name)),
		drivingIds: new Set(releasing.flatMap((r) => r.changesets ?? [])),
	};
};

const git = (...args) => execFileSync("git", args, { encoding: "utf-8" });
const lines = (out) => out.split("\n").filter(Boolean);

/** Published manifest at `ref`, or from disk when `ref` is null. */
const manifestAt = (ref, path) => {
	let raw;
	try {
		raw =
			ref === null
				? readFileSync(path, "utf-8")
				: git("show", `${ref}:${path}`);
	} catch {
		// Absent at this ref (new package, or deleted) — treat as a change.
		return null;
	}
	return publishedManifest(JSON.parse(raw));
};

/**
 * The release plan Changesets would produce right now, or null when it refuses
 * to produce one — which is what happens when nothing here releases anything.
 * Its stderr is surfaced on failure so a genuine tooling break is diagnosable
 * rather than being reported as a missing changeset.
 */
const releasePlan = () => {
	const out = join(mkdtempSync(join(tmpdir(), "changeset-gate-")), "plan.json");
	// Resolved against this file rather than the cwd, so the gate can be pointed
	// at another checkout.
	const bin = join(
		import.meta.dirname,
		"..",
		"node_modules",
		".bin",
		"changeset",
	);
	try {
		execFileSync(bin, ["status", "--output", out], { stdio: "pipe" });
		return { plan: JSON.parse(readFileSync(out, "utf-8")), error: null };
	} catch (cause) {
		return { plan: null, error: String(cause.stderr ?? cause.message).trim() };
	}
};

const fail = (message) => {
	console.error(message.join("\n"));
	process.exit(1);
};

const main = () => {
	// Everything this branch changed, including work not yet committed, against
	// the point it diverged — so a base branch that moved on cannot make an
	// unrelated PR look like it touched a published package.
	const since = git("merge-base", BASE, "HEAD").trim();
	const changed = [
		...lines(git("diff", "--name-only", since)),
		...lines(git("ls-files", "--others", "--exclude-standard")),
	];

	const affected = [
		...PACKAGES.map((dir) => `${dir}/package.json`).filter((path) => {
			const before = manifestAt(since, path);
			const after = manifestAt(null, path);
			return before === null || after === null || before !== after;
		}),
		...changed.filter(affectsPublishedArtifact),
	].sort();

	if (affected.length === 0) {
		console.log("No published package changed — no changeset required.");
		return;
	}

	const publishedNames = PACKAGES.map(
		(dir) => JSON.parse(readFileSync(`${dir}/package.json`, "utf-8")).name,
	);
	// Added, not merely changed: editing a changeset that already sits on the
	// base branch must not count as coverage this branch brought, or a breaking
	// change could ride along on somebody else's patch entry. Untracked files
	// are added by definition, and are what a local run before committing sees.
	const addedIds = [
		...lines(
			git("diff", "--name-only", "--diff-filter=A", since, "--", ".changeset"),
		),
		...lines(
			git("ls-files", "--others", "--exclude-standard", "--", ".changeset"),
		),
	]
		.filter((file) => file.endsWith(".md"))
		.map((file) => basename(file, ".md"));

	const { plan, error } = releasePlan();
	const { releasesPublished, drivingIds } = planCoverage(plan, publishedNames);

	const why = [
		"These changes reach the published packages, so they need a release:",
		...affected.map((path) => `  - ${path}`),
		"",
	];

	if (!releasesPublished)
		return fail([
			"Missing changeset.",
			"",
			...why,
			'Run `pnpm changeset` and include the root "kheopskit" package in the',
			"selection — the fixed group needs it or the release tag reuses the",
			"previous version.",
			...(error ? ["", "changeset status said:", error] : []),
		]);

	if (!addedIds.some((id) => drivingIds.has(id)))
		return fail([
			"Missing changeset on this branch.",
			"",
			...why,
			"A changeset already on the base branch would release these packages,",
			"but this branch adds none — the change would ship with no changelog",
			"entry of its own. Run `pnpm changeset`.",
		]);

	console.log(
		`${affected.length} published change(s), released by ${addedIds.filter((id) => drivingIds.has(id)).join(", ")}.`,
	);
};

if (import.meta.main) main();
