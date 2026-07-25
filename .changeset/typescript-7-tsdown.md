---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Build both packages with [tsdown](https://tsdown.dev) instead of tsup, and move the toolchain to TypeScript 7.

TypeScript 7 only ships a stable `tsc` binary — its main entry now exports just `version`, and the compiler API moved to `typescript/unstable/*`. Every tool that reaches for `require('typescript')` breaks, including the `rollup-plugin-dts` that tsup uses for declaration emit. tsdown declares support for TypeScript 7 and is tsup's successor.

The published layout is unchanged: `dist/index.mjs` + `dist/index.d.mts` for ESM and `dist/index.js` + `dist/index.d.ts` for CJS (`fixedExtension: false` preserves tsup's extensions), all `exports` entries resolve, the `"use client"` banner is still emitted for `@kheopskit/react`, and the per-entry bundle isolation check still passes for all 16 entry bundles. Chunk file names differ, since the bundler differs.
