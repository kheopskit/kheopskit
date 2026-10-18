# Contributing

## Release Process

This project uses [Changesets](https://github.com/changesets/changesets) to manage versioning and releases.

### How to release changes

#### 1. Create your PR with a changeset

When you make changes that should be released, include a changeset file in your PR:

```bash
pnpm changeset
```

This will prompt you to:
- Select the packages: always all three of `kheopskit`, `@kheopskit/core` and `@kheopskit/react`
- Choose the semver bump type (patch, minor, or major)
- Write a summary of the changes

The three packages form one fixed group in `.changeset/config.json`, so they always release under one version. Select the private root package `kheopskit` in every changeset, even when only one published package changed. The publish workflow names the GitHub release tag after the root package version. If the root version did not move, the tag already exists and the workflow fails after npm publish, with no GitHub release. `pnpm check:changeset` fails a pull request that changes a published package without a changeset. Run it locally with `BASE_REF=origin/main`, or after `git fetch origin main:main` in a worktree.

A markdown file will be created in `.changeset/` — commit it along with your code changes.

#### 2. Merge your PR to `main`

Once your PR is reviewed and merged, the CI will automatically create (or update) a **"Version Packages"** PR that:
- Bumps package versions in `package.json` files
- Updates `CHANGELOG.md` files
- Removes consumed changeset files

#### 3. Merge the "Version Packages" PR

When you're ready to release, merge the "Version Packages" PR. This triggers the publish workflow which:
- Builds the packages and checks the emitted type declarations (`pnpm check:dts`)
- Publishes packages to npm
- Creates a GitHub Release with the changelog

### Summary

```
┌─────────────────────────────────────────────────────────────────┐
│  Your PR (code changes + changeset)                             │
│                                                                 │
│  1. Make code changes                                           │
│  2. Run `pnpm changeset` to describe changes                    │
│  3. Commit both and open PR                                     │
│  4. Get review and merge to main                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  CI creates "Version Packages" PR (automatic)                   │
│                                                                 │
│  - Bumps versions                                               │
│  - Updates CHANGELOGs                                           │
│  - Accumulates multiple changesets if needed                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Merge "Version Packages" PR                                    │
│                                                                 │
│  - Packages published to npm                                    │
│  - GitHub Release created                                       │
└─────────────────────────────────────────────────────────────────┘
```

### Release candidates

`pnpm changeset pre enter rc` commits `.changeset/pre.json` and puts `main` in pre mode. The release PR is then titled "Version Packages (rc)" and versions the packages `X.Y.Z-rc.0`, `-rc.1` and so on. Merging it publishes them under the npm `rc` dist-tag, so `latest` does not move, and creates a GitHub prerelease. Testers install with `pnpm add @kheopskit/core@rc @kheopskit/react@rc`. `pnpm changeset pre exit` ends pre mode, and the next release PR versions the final `X.Y.Z` on `latest`. While in pre mode, `main` cannot release anything else.

### Notes

- If you merge multiple PRs with changesets before merging the "Version Packages" PR, they will all be batched into a single release.
- The root `kheopskit` package is private and won't be published, but its version is used for GitHub release tags.
- The `vite-react` example app is ignored from changesets.
- Packages are built once, up front, before anything is published — by the publish workflow, and by the root `publish` script for a manual release. Don't give `packages/*` a `prepack`/`prepare`/`prepublishOnly` build script: `changeset publish` runs `pnpm publish` for every package concurrently, so core's build would wipe `packages/core/dist` while react's declaration emit is still reading it — which is how `@kheopskit/react@5.1.1` shipped `useAccounts(): any`. `pnpm check:dts` fails if one is reintroduced.
