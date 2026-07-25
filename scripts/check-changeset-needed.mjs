#!/usr/bin/env node

/**
 * Fails a pull request that changes what npm consumers install from a
 * published package without adding a changeset that actually releases it.
 *
 * Only the dependency-related manifest fields are compared. They ship verbatim
 * to npm and dictate the install contract; everything else a dependency PR
 * usually touches — devDependencies, the lockfile, examples, workflows — leaves
 * the published artifact byte-identical. Requiring a changeset there would fail
 * nearly every PR and train everyone to bypass the gate.
 *
 * The check keys off the diff rather than the PR author or the Dependabot
 * group name, so a dependency added to `packages/core` later is covered without
 * touching any config.
 *
 * Coverage is decided by Changesets itself rather than by looking at filenames:
 * `changeset status` applies the real ignore/fixed rules, so a dot-prefixed
 * file, an `--empty` changeset, or one naming only an ignored example is
 * correctly seen as releasing nothing. The gate additionally requires the
 * release to be driven by a changeset *this branch added*, so an unrelated
 * changeset already sitting on main cannot silently cover a new dependency
 * change that would then ship with no changelog entry.
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
const PUBLISHED = ["packages/core/package.json", "packages/react/package.json"];

/**
 * Every manifest field npm reads when deciding what to install alongside the
 * package. `peerDependenciesMeta` earns its place: dropping an `optional: true`
 * turns a peer into a hard install requirement without any version range
 * changing. The rest are absent today but would ship the moment they appear.
 */
const DEPENDENCY_FIELDS = [
	"dependencies",
	"peerDependencies",
	"peerDependenciesMeta",
	"optionalDependencies",
	"bundledDependencies",
	"bundleDependencies",
];

/**
 * Key order in package.json and entry order in `bundledDependencies` carry no
 * meaning to npm, so normalise both before comparing — a reformat must not read
 * as a dependency change.
 */
const stable = (value) => {
	if (Array.isArray(value))
		return value
			.map(stable)
			.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, stable(value[key])]),
	);
};

/** The part of a manifest that changes what consumers install. */
export const dependencyContract = (pkg) =>
	JSON.stringify(
		stable(
			Object.fromEntries(
				DEPENDENCY_FIELDS.filter((field) => pkg[field] !== undefined).map(
					(field) => [field, pkg[field]],
				),
			),
		),
	);

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

/** Dependency contract of `path`, at `ref` or on disk when `ref` is null. */
const contractAt = (ref, path) => {
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
	return dependencyContract(JSON.parse(raw));
};

/**
 * The release plan Changesets would produce right now, or null when it refuses
 * to produce one — which is what happens when nothing here releases anything.
 * Its stderr is surfaced on failure so a genuine tooling break is diagnosable
 * rather than being reported as a missing changeset.
 */
const releasePlan = () => {
	const out = join(mkdtempSync(join(tmpdir(), "changeset-gate-")), "plan.json");
	try {
		execFileSync("node_modules/.bin/changeset", ["status", "--output", out], {
			stdio: "pipe",
		});
		return { plan: JSON.parse(readFileSync(out, "utf-8")), error: null };
	} catch (cause) {
		return { plan: null, error: String(cause.stderr ?? cause.message).trim() };
	}
};

const fail = (lines) => {
	console.error(lines.join("\n"));
	process.exit(1);
};

const main = () => {
	const affected = PUBLISHED.filter((path) => {
		const before = contractAt(BASE, path);
		const after = contractAt(null, path);
		return before === null || after === null || before !== after;
	});

	if (affected.length === 0) {
		console.log(
			"No published dependency contract changed — no changeset required.",
		);
		return;
	}

	const publishedNames = PUBLISHED.map(
		(path) => JSON.parse(readFileSync(path, "utf-8")).name,
	);
	const addedIds = git(
		"diff",
		"--name-only",
		"--diff-filter=A",
		`${BASE}...HEAD`,
	)
		.split("\n")
		// Untracked too, so a local run matches the working-tree manifests it
		// just compared against. CI only ever sees the committed set.
		.concat(
			git("ls-files", "--others", "--exclude-standard", ".changeset").split(
				"\n",
			),
		)
		.filter((file) => file.startsWith(".changeset/") && file.endsWith(".md"))
		.map((file) => basename(file, ".md"));

	const { plan, error } = releasePlan();
	const { releasesPublished, drivingIds } = planCoverage(plan, publishedNames);
	const covered = addedIds.some((id) => drivingIds.has(id));

	const why = [
		"These published manifests changed what consumers install, so the change",
		"needs a release:",
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
			...(error ? ["", `changeset status said:`, error] : []),
		]);

	if (!covered)
		return fail([
			"Missing changeset on this branch.",
			"",
			...why,
			"A changeset already on the base branch would release these packages,",
			"but this branch adds none — the dependency change would ship with no",
			"changelog entry of its own. Run `pnpm changeset`.",
		]);

	console.log(
		`Published dependency contract changed in ${affected.join(", ")}, released by ${addedIds.filter((id) => drivingIds.has(id)).join(", ")}.`,
	);
};

if (import.meta.main) main();
