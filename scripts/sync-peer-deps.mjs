#!/usr/bin/env node

/**
 * Syncs peer dependency versions after changeset version bump.
 * Updates @kheopskit/react peerDependency on @kheopskit/core to match core's version.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packagesDir = join(__dirname, "..", "packages");

const corePackagePath = join(packagesDir, "core", "package.json");
const reactPackagePath = join(packagesDir, "react", "package.json");

const corePackage = JSON.parse(readFileSync(corePackagePath, "utf-8"));
const reactPackage = JSON.parse(readFileSync(reactPackagePath, "utf-8"));

const coreVersion = corePackage.version;
const currentPeerVersion = reactPackage.peerDependencies?.["@kheopskit/core"];
const newPeerVersion = `^${coreVersion}`;

if (currentPeerVersion !== newPeerVersion) {
	console.log(
		`Updating @kheopskit/react peerDependency @kheopskit/core: ${currentPeerVersion} → ${newPeerVersion}`,
	);
	reactPackage.peerDependencies["@kheopskit/core"] = newPeerVersion;
	writeFileSync(reactPackagePath, `${JSON.stringify(reactPackage, null, "\t")}\n`);
} else {
	console.log(
		`@kheopskit/react peerDependency @kheopskit/core already at ${newPeerVersion}`,
	);
}
