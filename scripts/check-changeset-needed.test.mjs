import { describe, expect, it } from "vitest";
import { dependencyContract, planCoverage } from "./check-changeset-needed.mjs";

describe("dependencyContract", () => {
	it("ignores fields that never reach npm", () => {
		const base = {
			name: "@kheopskit/core",
			dependencies: { "lodash-es": "^4" },
		};
		expect(
			dependencyContract({ ...base, devDependencies: { viem: "^2" } }),
		).toBe(dependencyContract({ ...base, devDependencies: { viem: "^3" } }));
		expect(dependencyContract({ ...base, version: "1.0.0" })).toBe(
			dependencyContract({ ...base, version: "2.0.0" }),
		);
	});

	it("is insensitive to key order and bundled entry order", () => {
		expect(
			dependencyContract({
				dependencies: { b: "^1", a: "^1" },
				bundledDependencies: ["b", "a"],
			}),
		).toBe(
			dependencyContract({
				bundledDependencies: ["a", "b"],
				dependencies: { a: "^1", b: "^1" },
			}),
		);
	});

	it("detects a dependency range change", () => {
		expect(
			dependencyContract({ dependencies: { "@scure/base": "^1" } }),
		).not.toBe(dependencyContract({ dependencies: { "@scure/base": "^2" } }));
	});

	// The case that motivated widening beyond `dependencies`/`peerDependencies`:
	// no version string moves, but the peer stops being optional.
	it("detects an optional peer becoming required", () => {
		const peerDependencies = { viem: ">=2.0.0" };
		expect(
			dependencyContract({
				peerDependencies,
				peerDependenciesMeta: { viem: { optional: true } },
			}),
		).not.toBe(dependencyContract({ peerDependencies }));
	});

	it("detects added optional and bundled dependencies", () => {
		expect(dependencyContract({})).not.toBe(
			dependencyContract({ optionalDependencies: { fsevents: "^2" } }),
		);
		expect(dependencyContract({})).not.toBe(
			dependencyContract({ bundledDependencies: ["lodash-es"] }),
		);
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
		const { releasesPublished, drivingIds } = planCoverage(plan, published);
		expect(releasesPublished).toBe(true);
		expect(drivingIds).toEqual(new Set(["root-only"]));
	});
});
