#!/usr/bin/env node

/**
 * Fails a pull request that changes a published package's `dependencies` or
 * `peerDependencies` without adding a changeset.
 *
 * Those two fields are the only part of a dependency bump that reaches npm
 * consumers: they ship verbatim in the published manifest and dictate what
 * gets installed alongside our packages. Everything else a Dependabot PR
 * usually touches — devDependencies, the lockfile, examples, workflows — leaves
 * the published artifact byte-identical, so requiring a changeset there would
 * fail nearly every PR and train everyone to bypass the gate.
 *
 * The check keys off the diff rather than the PR author or the Dependabot
 * group name, so a dependency added to `packages/core` later is covered without
 * touching any config.
 *
 * It only asserts that *a* changeset was added, not which package it names:
 * the `fixed` group in .changeset/config.json versions kheopskit,
 * @kheopskit/core and @kheopskit/react in lockstep, so any changeset bumps all
 * three anyway.
 *
 * Run on pull requests only, and skip the changesets release PR — it rewrites
 * peerDependencies via `sync-peer-deps` while deleting the changesets it
 * consumed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_REF ?? "origin/main";
const PUBLISHED = ["packages/core/package.json", "packages/react/package.json"];

const git = (...args) => execFileSync("git", args, { encoding: "utf-8" });

/** Dependency fields of `path`, at `ref` or on disk when `ref` is null. */
const fieldsAt = (ref, path) => {
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
	const pkg = JSON.parse(raw);
	return JSON.stringify({
		dependencies: pkg.dependencies ?? {},
		peerDependencies: pkg.peerDependencies ?? {},
	});
};

const affected = PUBLISHED.filter((path) => {
	const before = fieldsAt(BASE, path);
	const after = fieldsAt(null, path);
	return before === null || after === null || before !== after;
});

if (affected.length === 0) {
	console.log(
		"No published dependency ranges changed — no changeset required.",
	);
	process.exit(0);
}

const isChangeset = (file) =>
	file.startsWith(".changeset/") && file.endsWith(".md");

// Committed on this branch, plus anything still untracked so a local run
// matches the working-tree manifests it just compared against. CI only ever
// sees the committed set.
const addedChangesets = [
	...git("diff", "--name-only", "--diff-filter=A", `${BASE}...HEAD`).split(
		"\n",
	),
	...git("ls-files", "--others", "--exclude-standard", ".changeset").split(
		"\n",
	),
].filter(isChangeset);

if (addedChangesets.length > 0) {
	console.log(
		`Published dependency ranges changed in ${affected.join(", ")}, covered by ${addedChangesets.join(", ")}.`,
	);
	process.exit(0);
}

console.error(
	[
		"Missing changeset.",
		"",
		"These published manifests changed their dependency ranges, so npm",
		"consumers get something different and the change needs a release:",
		...affected.map((path) => `  - ${path}`),
		"",
		'Run `pnpm changeset` and include the root "kheopskit" package in the',
		"selection — the fixed group needs it or the release tag reuses the",
		"previous version.",
	].join("\n"),
);
process.exit(1);
