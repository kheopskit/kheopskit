import { describe, expect, it } from "vitest";
import {
	affectsPublishedArtifact,
	planCoverage,
	publishedManifest,
} from "./check-changeset-needed.mjs";

describe("publishedManifest", () => {
	it("ignores the fields consumers never observe", () => {
		const base = {
			name: "@kheopskit/core",
			dependencies: { "lodash-es": "^4" },
		};
		expect(
			publishedManifest({ ...base, devDependencies: { viem: "^2" } }),
		).toBe(publishedManifest({ ...base, devDependencies: { viem: "^3" } }));
		expect(publishedManifest({ ...base, version: "1.0.0" })).toBe(
			publishedManifest({ ...base, version: "2.0.0" }),
		);
	});

	it("is insensitive to key order", () => {
		expect(
			publishedManifest({
				dependencies: { b: "^1", a: "^1" },
				files: ["dist"],
			}),
		).toBe(
			publishedManifest({
				files: ["dist"],
				dependencies: { a: "^1", b: "^1" },
			}),
		);
	});

	// Node takes the first condition that matches, so `default` above `types`
	// changes what consumers resolve without any key or value moving.
	it("detects a reordered export condition", () => {
		expect(
			publishedManifest({
				exports: {
					".": { types: "./dist/index.d.ts", default: "./dist/index.mjs" },
				},
			}),
		).not.toBe(
			publishedManifest({
				exports: {
					".": { default: "./dist/index.mjs", types: "./dist/index.d.ts" },
				},
			}),
		);
	});

	// An `exports` fallback array is resolved in order too.
	it("detects a reordered array", () => {
		expect(
			publishedManifest({ exports: { ".": ["./dist/a.mjs", "./dist/b.mjs"] } }),
		).not.toBe(
			publishedManifest({ exports: { ".": ["./dist/b.mjs", "./dist/a.mjs"] } }),
		);
		expect(publishedManifest({ files: ["dist", "README.md"] })).not.toBe(
			publishedManifest({ files: ["README.md", "dist"] }),
		);
	});

	it("detects a dependency range change", () => {
		expect(
			publishedManifest({ dependencies: { "@scure/base": "^1" } }),
		).not.toBe(publishedManifest({ dependencies: { "@scure/base": "^2" } }));
	});

	// No version string moves here, but the peer stops being optional.
	it("detects an optional peer becoming required", () => {
		const peerDependencies = { viem: ">=2.0.0" };
		expect(
			publishedManifest({
				peerDependencies,
				peerDependenciesMeta: { viem: { optional: true } },
			}),
		).not.toBe(publishedManifest({ peerDependencies }));
	});

	// Comparing everything but the excluded fields means these need no
	// enumeration to be caught.
	it("detects changes to fields nobody enumerated", () => {
		expect(
			publishedManifest({ exports: { ".": "./dist/index.mjs" } }),
		).not.toBe(publishedManifest({ exports: { ".": "./dist/main.mjs" } }));
		expect(publishedManifest({ files: ["dist"] })).not.toBe(
			publishedManifest({ files: ["dist", "README.md"] }),
		);
		expect(publishedManifest({ engines: { node: ">=22" } })).not.toBe(
			publishedManifest({ engines: { node: ">=24" } }),
		);
		expect(publishedManifest({ tsdown: { target: "es2020" } })).not.toBe(
			publishedManifest({ tsdown: { target: "es2022" } }),
		);
		expect(publishedManifest({})).not.toBe(
			publishedManifest({ optionalDependencies: { fsevents: "^2" } }),
		);
	});
});

describe("affectsPublishedArtifact", () => {
	it("counts source and shipped docs", () => {
		expect(affectsPublishedArtifact("packages/core/src/index.ts")).toBe(true);
		expect(affectsPublishedArtifact("packages/react/src/nested/deep.tsx")).toBe(
			true,
		);
		expect(affectsPublishedArtifact("packages/core/README.md")).toBe(true);
		expect(affectsPublishedArtifact("packages/core/MIGRATING_TO_V4.md")).toBe(
			true,
		);
		expect(affectsPublishedArtifact("packages/core/tsconfig.build.json")).toBe(
			true,
		);
	});

	it("skips what cannot reach the tarball", () => {
		expect(affectsPublishedArtifact("packages/core/src/ssr.test.ts")).toBe(
			false,
		);
		expect(affectsPublishedArtifact("packages/react/src/store.test.tsx")).toBe(
			false,
		);
		expect(affectsPublishedArtifact("packages/core/CHANGELOG.md")).toBe(false);
		expect(affectsPublishedArtifact("packages/core/tsconfig.tsbuildinfo")).toBe(
			false,
		);
	});

	// Compared field-wise instead, so a devDependency bump is not a change.
	it("leaves package.json to the manifest comparison", () => {
		expect(affectsPublishedArtifact("packages/core/package.json")).toBe(false);
	});

	// Both build tsconfigs extend it, so a compiler option there rewrites the
	// emitted output of packages whose own files never moved.
	it("counts shared build inputs", () => {
		expect(affectsPublishedArtifact("tsconfig.base.json")).toBe(true);
	});

	it("ignores everything outside the published packages", () => {
		for (const file of [
			"examples/vite-react/src/main.tsx",
			".github/workflows/ci.yml",
			"pnpm-lock.yaml",
			"scripts/check-changeset-needed.mjs",
			"packages-not-really/core/src/index.ts",
		])
			expect(affectsPublishedArtifact(file)).toBe(false);
	});
});

describe("planCoverage", () => {
	const published = ["@kheopskit/core", "@kheopskit/react"];

	it("treats a refused plan as covering nothing", () => {
		expect(planCoverage(null, published)).toEqual({
			releasesPublished: false,
			drivingIds: new Set(),
		});
	});

	// An `--empty` changeset, a dot-prefixed file, or one naming only an ignored
	// example all land here: Changesets reports the published packages as
	// `none`, so nothing is actually released.
	it("does not count releases of type none", () => {
		const plan = {
			releases: [
				{ name: "@kheopskit/core", type: "none", changesets: [] },
				{ name: "vite-react", type: "none", changesets: ["ignored-only"] },
			],
		};
		expect(planCoverage(plan, published)).toEqual({
			releasesPublished: false,
			drivingIds: new Set(),
		});
	});

	// The fixed group bumps react and the root alongside core, but attributes
	// the changeset id only to the package the changeset named.
	it("collects driving ids across the whole fixed group", () => {
		const plan = {
			releases: [
				{
					name: "@kheopskit/core",
					type: "patch",
					changesets: ["noble-hashes"],
				},
				{ name: "@kheopskit/react", type: "patch", changesets: [] },
				{ name: "kheopskit", type: "patch", changesets: [] },
				{ name: "vite-react", type: "none", changesets: [] },
			],
		};
		expect(planCoverage(plan, published)).toEqual({
			releasesPublished: true,
			drivingIds: new Set(["noble-hashes"]),
		});
	});

	it("counts a changeset that names only the private root package", () => {
		const plan = {
			releases: [
				{ name: "kheopskit", type: "patch", changesets: ["root-only"] },
				{ name: "@kheopskit/core", type: "patch", changesets: [] },
			],
		};
		expect(planCoverage(plan, published)).toEqual({
			releasesPublished: true,
			drivingIds: new Set(["root-only"]),
		});
	});
});
