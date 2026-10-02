# Kheopskit playground verification map

This directory is the maintained source for verifying Kheopskit's user-visible behavior through the playground apps. Read this index first, then use the matching feature file as the recipe. Launch, doctor, evidence, and cleanup are defined in [`../SKILL.md`](../SKILL.md).

## Baseline preconditions

- `.claude/skills/verify/scripts/doctor.sh` prints `doctor: ready`.
- The mock path is driven through `.claude/skills/verify/scripts/run.sh <app> <spec>`, and the spec imports from `.claude/skills/verify/helpers`.
- The real-wallet path is driven through `.claude/skills/verify/scripts/serve.sh start <app>` plus a new claude-in-chrome tab on `http://localhost:<port>`.
- Every test starts on a fresh browser context, with no persisted `kheopskit` state and all wallets disconnected.
- Never drive a server that this run did not start, including the e2e servers (41xx) and the user's dev servers (300x).

## Driving conventions

- Scope rows to `walletsTable(page)` (column header `Accounts`) or `accountsTable(page)` (column header `Address`). Wallet names appear in both tables.
- Select a row by its accessible name, for example `getByRole("row", { name: /Mock Ethereum Wallet/ })`. Select a button by its label (`Connect`, `Disconnect`, `Sign`, `Send`).
- The app heading is `Kheopskit Playground - Vite.js`, `- Next.js`, or `- Tanstack`. Match `/Kheopskit Playground/` to stay app-agnostic.
- Wait on locators (`toBeVisible`, `toBeEnabled`, `expect.poll`) rather than fixed sleeps.
- Default to vite-react. Run nextjs-react and tanstack-start too when the change touches SSR, hydration, cookies, or `ssrCookies`.

## Proof and skip reporting

- Call `snap` after each user action, so the evidence pairs the action with its resulting state.
- A mutation proof includes the persisted `kheopskit` state (`readPersistedState` + `saveJson`) or a reload that shows the state survived.
- Record the app, the feature ID, and the evidence directory with every claim.
- When a sub-feature needs a real wallet and you did not drive one, report it as not verified. Name the unmet precondition. Do not report a mock run as proof of a real-wallet path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph that describes the user-visible behavior. It then has exactly four H2 sections, in this order:

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with <harness>` starts with `Preconditions:`, then uses labeled bullets that pair each user action with exact Playwright code and the observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Seed status

Recipes executed against the live app when this map was created (2026-10-02), each with a working spec in `../specs/`:

- `sign-polkadot`, `sign-ethereum`, `sign-solana`, `connect-wallet`, `disconnect-wallet` on vite-react (`sign-message.spec.ts`).
- `persist-cookie`, `auto-reconnect` on nextjs-react and tanstack-start (`persistence.spec.ts`).
- `discovery-*`, `discovery-count`, `wagmi-active`, `wagmi-sign` on vite-react (`discovery-wagmi.spec.ts`).

Everything else, including all of [submit-tx](./submit-tx.md), was written from source and has not been driven. Treat it as a draft until a run confirms it.

## Features

- [Wallet discovery](./wallet-discovery.md) covers the Wallets table listing injected Polkadot, Ethereum, and Solana wallets plus the WalletConnect row.
- [Connect and disconnect](./connect-disconnect.md) covers the wallet connection lifecycle and the Accounts table it drives.
- [Sign a message](./sign-message.md) covers the per-account `Sign` button on all three platforms.
- [Persistence and reload](./persistence-reload.md) covers storage, auto-reconnect, the no-flicker hydration, and SSR cookies.
- [Submit a transaction](./submit-tx.md) covers the 0-value transfer block (real wallet only).
- [Usage with Wagmi](./wagmi.md) covers the Wagmi connectors list and signing through a Kheopskit account.
