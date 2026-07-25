/**
 * End-to-end tests for the changeset gate, driven against throwaway git
 * repositories.
 *
 * The unit tests cover the pure helpers; these cover what the helpers cannot
 * see — where a path came from. Whether a changeset was *added* by the branch
 * or merely edited, and what the merge base was, are answered by git, so the
 * only honest way to test them is to build a repository that has that history
 * and run the real script against it.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";

// Each case boots the Changesets CLI in a child process, and they all run at
// once — well past the default per-test timeout on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

const SCRIPT = join(import.meta.dirname, "check-changeset-needed.mjs");

const CORE = {
	name: "@kheopskit/core",
	version: "1.0.0",
	exports: {
		".": {
			import: { types: "./dist/index.d.mts", default: "./dist/index.mjs" },
		},
	},
	files: ["dist"],
	dependencies: { "lodash-es": "^4.17.21" },
	devDependencies: { vitest: "^3.0.0" },
};

const REACT = {
	name: "@kheopskit/react",
	version: "1.0.0",
	exports: { ".": "./dist/index.mjs" },
	files: ["dist"],
};

const CONFIG = {
	changelog: false,
	commit: false,
	access: "public",
	baseBranch: "main",
	updateInternalDependencies: "patch",
	fixed: [["kheopskit", "@kheopskit/core", "@kheopskit/react"]],
	ignore: ["vite-react"],
};

const changeset = (pkg, type, summary) =>
	`---\n"${pkg}": ${type}\n---\n\n${summary}\n`;

const git = (cwd, ...args) =>
	execFileSync("git", args, { cwd, encoding: "utf-8" });

const write = (repo, path, content) => {
	mkdirSync(join(repo, dirname(path)), { recursive: true });
	writeFileSync(
		join(repo, path),
		typeof content === "string"
			? content
			: `${JSON.stringify(content, null, 2)}\n`,
	);
};

/**
 * A repository shaped like this one — a private root in a fixed group with two
 * published packages — sitting on a branch that has diverged from `main`.
 */
const fixture = ({ base = {}, ...rest } = {}) => {
	// A typo here silently produces a repository where the "base" file was added
	// by the branch — which is exactly what the provenance tests assert against.
	const unknown = Object.keys(rest);
	if (unknown.length) throw new Error(`unknown fixture option: ${unknown}`);

	const repo = mkdtempSync(join(tmpdir(), "changeset-gate-test-"));
	onTestFinished(() => rmSync(repo, { recursive: true, force: true }));

	git(repo, "init", "-q", "-b", "main");
	git(repo, "config", "user.email", "gate@test.invalid");
	git(repo, "config", "user.name", "gate");

	write(repo, "package.json", {
		name: "kheopskit",
		private: true,
		version: "1.0.0",
	});
	write(
		repo,
		"pnpm-workspace.yaml",
		"packages:\n  - packages/*\n  - examples/*\n  - .\n",
	);
	write(repo, "tsconfig.base.json", { compilerOptions: { target: "ES2022" } });
	write(repo, ".changeset/config.json", CONFIG);
	write(repo, "packages/core/package.json", CORE);
	write(repo, "packages/core/src/index.ts", "export const version = 1;\n");
	write(repo, "packages/react/package.json", REACT);
	write(repo, "packages/react/src/index.ts", "export const version = 1;\n");
	// Present so the `ignore` list resolves, and so a changeset can name it.
	write(repo, "examples/vite-react/package.json", {
		name: "vite-react",
		private: true,
		version: "0.0.0",
	});
	for (const [path, content] of Object.entries(base))
		write(repo, path, content);

	git(repo, "add", "-A");
	git(repo, "commit", "-qm", "init");
	git(repo, "checkout", "-qb", "feature");

	// The base branch keeps moving under real PRs; every scenario runs against a
	// merge base, so this must never leak into what the branch looks like.
	git(repo, "checkout", "-q", "main");
	write(repo, "README.md", "moved on\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-qm", "unrelated base commit");
	git(repo, "checkout", "-q", "feature");

	return repo;
};

const commit = (repo, message) => {
	git(repo, "add", "-A");
	git(repo, "commit", "-qm", message);
};

/**
 * Runs the real script against `repo`. Asynchronous so the cases can overlap:
 * almost all of the wall clock is booting the Changesets CLI once per case.
 */
const gate = (repo) =>
	new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [SCRIPT], {
			cwd: repo,
			env: { ...process.env, BASE_REF: "main" },
		});
		let output = "";
		child.stdout.setEncoding("utf-8").on("data", (chunk) => {
			output += chunk;
		});
		child.stderr.setEncoding("utf-8").on("data", (chunk) => {
			output += chunk;
		});
		child.on("error", reject);
		child.on("close", (status) => resolve({ status, output }));
	});

// Each case is an independent repository and an independent child process, and
// most of the wall clock is booting the Changesets CLI — so run them at once.
describe.concurrent("changeset gate", () => {
	it("passes when nothing published changed", async () => {
		const repo = fixture();
		write(repo, "examples/app/main.ts", "console.log(1);\n");
		commit(repo, "example only");

		expect((await gate(repo)).output).toContain("No published package changed");
	});

	it("fails when source changes with no changeset", async () => {
		const repo = fixture();
		write(repo, "packages/core/src/index.ts", "export const version = 2;\n");
		commit(repo, "source");

		const { status, output } = await gate(repo);
		expect(status).toBe(1);
		expect(output).toContain("Missing changeset.");
		expect(output).toContain("packages/core/src/index.ts");
	});

	it("passes when the branch adds a changeset", async () => {
		const repo = fixture();
		write(repo, "packages/core/src/index.ts", "export const version = 2;\n");
		write(
			repo,
			".changeset/brave-pandas-sing.md",
			changeset("@kheopskit/core", "patch", "fix"),
		);
		commit(repo, "source + changeset");

		expect((await gate(repo)).status).toBe(0);
	});

	// What a local run before committing sees.
	it("counts an uncommitted changeset", async () => {
		const repo = fixture();
		write(repo, "packages/core/src/index.ts", "export const version = 2;\n");
		write(
			repo,
			".changeset/brave-pandas-sing.md",
			changeset("@kheopskit/core", "patch", "fix"),
		);

		expect((await gate(repo)).status).toBe(0);
	});

	// Provenance: the changeset exists and releases core, but it came from the
	// base branch. Editing it must not launder an unrelated change into the
	// release — it would ship with no changelog entry of its own.
	it("rejects a changeset the branch only edited", async () => {
		const repo = fixture({
			base: {
				".changeset/tidy-moons-wave.md": changeset(
					"@kheopskit/core",
					"patch",
					"someone else's fix",
				),
			},
		});
		write(
			repo,
			".changeset/tidy-moons-wave.md",
			changeset("@kheopskit/core", "patch", "someone else's fix, retyped"),
		);
		write(repo, "packages/core/src/index.ts", "export const version = 2;\n");
		commit(repo, "edit base changeset + source");

		const { status, output } = await gate(repo);
		expect(status).toBe(1);
		expect(output).toContain("Missing changeset on this branch.");
	});

	// Control for the above: same base changeset present and untouched, branch
	// adds its own — the base one being there is not itself the problem.
	it("accepts its own changeset alongside a base one", async () => {
		const repo = fixture({
			base: {
				".changeset/tidy-moons-wave.md": changeset(
					"@kheopskit/core",
					"patch",
					"someone else's fix",
				),
			},
		});
		write(repo, "packages/core/src/index.ts", "export const version = 2;\n");
		write(
			repo,
			".changeset/brave-pandas-sing.md",
			changeset("@kheopskit/core", "patch", "fix"),
		);
		commit(repo, "source + changeset");

		expect((await gate(repo)).status).toBe(0);
	});

	// Nothing under packages/ moved, yet both build tsconfigs extend this file.
	it("fails on a shared build input change", async () => {
		const repo = fixture();
		write(repo, "tsconfig.base.json", {
			compilerOptions: { target: "ES2017" },
		});
		commit(repo, "lower the target");

		const { status, output } = await gate(repo);
		expect(status).toBe(1);
		expect(output).toContain("tsconfig.base.json");
	});

	it("ignores a devDependency bump", async () => {
		const repo = fixture();
		write(repo, "packages/core/package.json", {
			...CORE,
			devDependencies: { vitest: "^4.0.0" },
		});
		commit(repo, "bump devDep");

		expect((await gate(repo)).output).toContain("No published package changed");
	});

	it("fails on a dependency range bump", async () => {
		const repo = fixture();
		write(repo, "packages/core/package.json", {
			...CORE,
			dependencies: { "lodash-es": "^5.0.0" },
		});
		commit(repo, "bump dep");

		const { status, output } = await gate(repo);
		expect(status).toBe(1);
		expect(output).toContain("packages/core/package.json");
	});

	// Every key and value is identical; only the condition order moved.
	it("fails on a reordered export condition", async () => {
		const repo = fixture();
		write(repo, "packages/core/package.json", {
			...CORE,
			exports: {
				".": {
					import: { default: "./dist/index.mjs", types: "./dist/index.d.mts" },
				},
			},
		});
		commit(repo, "reorder exports");

		expect((await gate(repo)).status).toBe(1);
	});

	// An ignored package releases nothing, so a changeset naming only it cannot
	// cover a real change.
	it("rejects a changeset that releases only an ignored package", async () => {
		const repo = fixture();
		write(repo, "packages/core/src/index.ts", "export const version = 2;\n");
		write(
			repo,
			".changeset/quiet-lions-nap.md",
			changeset("vite-react", "patch", "example"),
		);
		commit(repo, "source + example changeset");

		expect((await gate(repo)).status).toBe(1);
	});

	// The base branch moved on with an unrelated commit in every fixture; a
	// two-dot diff against the tip would drag README.md in.
	it("diffs from the merge base, not the base tip", async () => {
		const repo = fixture();

		expect((await gate(repo)).output).toContain("No published package changed");
	});
});
