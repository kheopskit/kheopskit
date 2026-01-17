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
- Select which packages changed (`@kheopskit/core`, `@kheopskit/react`)
- Choose the semver bump type (patch, minor, or major)
- Write a summary of the changes

A markdown file will be created in `.changeset/` — commit it along with your code changes.

#### 2. Merge your PR to `main`

Once your PR is reviewed and merged, the CI will automatically create (or update) a **"Version Packages"** PR that:
- Bumps package versions in `package.json` files
- Updates `CHANGELOG.md` files
- Removes consumed changeset files

#### 3. Merge the "Version Packages" PR

When you're ready to release, merge the "Version Packages" PR. This triggers the publish workflow which:
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

### Notes

- If you merge multiple PRs with changesets before merging the "Version Packages" PR, they will all be batched into a single release.
- The root `kheopskit` package is private and won't be published, but its version is used for GitHub release tags.
- The `vite-react` example app is ignored from changesets.
