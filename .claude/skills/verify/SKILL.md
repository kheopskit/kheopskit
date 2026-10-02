---
name: verify
description: Drive the Kheopskit playground apps (vite-react, nextjs-react, tanstack-start) in a real browser to prove wallet discovery, connect/disconnect, message signing, persistence across reload, and transaction submission. Use after changing packages/core, packages/react, or an example app, or whenever a claim about Kheopskit's user-visible behavior needs evidence.
---

# Verify Kheopskit

Kheopskit is a library, so its user surface is the three playground apps in `examples/`. Each renders the same page: a Wallets table, an Accounts table, a "Submitting a transaction" block, and a "Usage with Wagmi" block. This skill lives at the repo root, not in a package, because the harness (`e2e/`) and every proof cut across `packages/core`, `packages/react`, and the examples.

The apps import `packages/*/dist`, not `src`. A change under `packages/` is invisible until it is rebuilt. `run.sh` and `serve.sh` rebuild by default.

There are two ways to drive the apps:

| Path | Wallets | Proves | Tool |
| --- | --- | --- | --- |
| Mock (default) | `e2e/mocks/mock-wallets.js`, injected before app code | discovery, connect/disconnect, sign message, persistence, reload | `scripts/run.sh` + a Playwright spec |
| Real wallet | Browser extensions in the user's Chrome | transaction submission, WalletConnect, real extension quirks | `scripts/serve.sh` + claude-in-chrome or agent-browser |

The mock wallets answer only connect, account listing, and signing. Any other method throws (for example, `[mock-eth-wallet] unsupported method`). Prove transaction submission and WalletConnect on the real-wallet path, or report them as not verified.

All paths below are relative to the repo root.

## Doctor

Run this first, and again whenever something looks off:

```bash
.claude/skills/verify/scripts/doctor.sh
```

Read-only. It checks node >=24, `@playwright/test`, the Playwright chromium install, whether `packages/*/dist` and each app build are older than their sources, and who holds each app's ports. It exits 1 on `FAIL`. `WARN` lines about stale builds are fine when you let `run.sh` rebuild.

## Ports and isolation

| App | Verify port (this skill) | e2e port (`pnpm test:e2e`) | Dev port (user's `pnpm dev:*`) |
| --- | --- | --- | --- |
| vite-react | 4201 | 4101 | 3001 |
| nextjs-react | 4202 | 4102 | 3002 |
| tanstack-start | 4203 | 4103 | 3003 |

- Dev servers read sources directly, and Next 16 writes `next dev` output to `.next/dev`. Verification builds never disturb the user's dev servers, so leave them running.
- A production build replaces the files that e2e and verify servers serve. `run.sh` and `serve.sh` refuse with exit 3 when the app's verify or e2e port is busy. Do not work around this. Wait for the other run to finish, or stop only a server that you started.
- One verify instance per app at a time. You can drive different apps concurrently.

## Launch and drive: mock path

Write a Playwright spec, then run it:

```bash
.claude/skills/verify/scripts/run.sh <vite-react|nextjs-react|tanstack-start> <spec-file> [--no-build] [playwright args...]
```

`run.sh` does the following:

1. Creates `.verify/evidence/<timestamp>-<app>-<spec>/` and copies the spec and `git rev-parse HEAD` + `git status --short` into it.
2. Runs `pnpm build:packages` and `pnpm --filter <app> build`. The log goes to `build.log` (about 15 s for vite-react). Use `--no-build` only when doctor reports both builds up to date.
3. Runs the spec with `.claude/skills/verify/playwright.config.ts`. Playwright starts the app's production server on its verify port. The server is ready when Playwright's `webServer` probe gets a response. Playwright stops the server when the run ends.
4. Prints `Evidence: <dir>` and exits with Playwright's status.

Extra arguments go to Playwright, for example `-g "solana"` or `--headed`.

Put scratch specs in `.verify/specs/` (gitignored). Import everything from the helpers module:

```ts
import {
	accountsTable,
	expect,
	MOCK_WALLETS,
	readPersistedState,
	saveJson,
	snap,
	test,
	walletsTable,
} from "../../.claude/skills/verify/helpers";
```

The helpers module provides these exports:

- `test`, `expect` come from `e2e/fixtures.ts`. They inject the mock wallets into every page, and they fail the test on any `console.error` or page error.
- `walletsTable(page)` is the table with an `Accounts` column header. `accountsTable(page)` is the table with an `Address` column header. Both tables contain wallet names, so always scope rows to one of them.
- `MOCK_WALLETS[platform]` holds `{ wallet, account }` row-name regexes for `polkadot`, `ethereum`, and `solana`.
- `snap(page, testInfo, "01-name")` writes `01-name.png` (full page, animations settled) and `01-name.aria.yml` (an ARIA snapshot).
- `readPersistedState(page)` returns `{ localStorage, cookie }` for the `kheopskit` storage key. `saveJson(testInfo, name, value)` writes it as evidence.

`.claude/skills/verify/specs/` holds working specs you can copy: `sign-message`, `persistence`, and `discovery-wagmi`. Run one unchanged as a smoke drive:

```bash
.claude/skills/verify/scripts/run.sh vite-react .claude/skills/verify/specs/sign-message.spec.ts
```

The per-feature recipes, selectors, and expected end states are in [`features/README.md`](features/README.md). Read the matching feature file before you write a spec.

## Launch and drive: real-wallet path

Start a long-lived production server:

```bash
.claude/skills/verify/scripts/serve.sh start <app> [--no-build]
.claude/skills/verify/scripts/serve.sh status
.claude/skills/verify/scripts/serve.sh stop <app>
```

`start` builds, launches the server in its own process group, records the group ID in `.verify/run/<app>.pid`, and polls `curl` until it gets HTTP 200. It prints `<app> ready at http://localhost:<port>`. The server log is `.verify/run/<app>.log`.

Open `http://localhost:<port>` in a new tab with claude-in-chrome (the user's Chrome has the wallet extensions) and drive the page with the same roles and names that the feature files use.

**Signing rule.** Approve or sign in a wallet extension only when the signer account's name contains `Guardians`. Read the account name in the extension popup before every approval. If the signer is any other account, stop and ask the user. Transactions on this path go to real networks, such as Polkadot Asset Hub, Ethereum chains, and Solana mainnet.

## Evidence

Each `run.sh` run keeps its evidence in `.verify/evidence/<run-id>/`:

- `artifacts/<test>/NN-*.png` and `NN-*.aria.yml` are the step snapshots from `snap`.
- `artifacts/<test>/test-finished-1.png` is the final screenshot. `trace.zip` holds the full trace, including network and console output. View it with `pnpm exec playwright show-trace <path>`.
- `report.json`, `playwright.log`, and `build.log` are the machine and human run logs.
- `git-head.txt` and the copied spec record which code was driven, and how.

The real-wallet path has no automatic evidence. Save screenshots and console output into `.verify/evidence/<timestamp>-<app>-real-<feature>/` yourself.

Proof standards:

- Drive the real user path: click `Connect`, `Sign`, and `Disconnect`. Do not call `getKheopskit$` or set storage from the test.
- Call `snap` after each action, so the evidence shows both the action and the state it produced. A final screenshot alone is not proof.
- Check side effects as well as the visible UI. Connected wallets persist under the `kheopskit` key: localStorage on vite-react, the `kheopskit` cookie on nextjs-react and tanstack-start. Use `readPersistedState` and `saveJson`.
- Mocks are acceptable only because wallet extensions are an external process boundary. Never mock `@kheopskit/*`.
- When a proof needs one app, use vite-react. When a change touches SSR, hydration, cookies, or `ssrCookies`, also run nextjs-react and tanstack-start.

## Cleanup

- Mock path: there is nothing to clean up. Playwright stops the server it started, even when tests fail. Confirm with doctor (`doctor: ready`, no `FAIL` on ports 42xx).
- Real-wallet path: run `serve.sh stop <app>`. It kills only the process group recorded in the pidfile, and it refuses when the port belongs to someone else.
- Delete `.verify/specs/` scratch specs if you like. Never delete `.verify/evidence/`, because that is where the proof lives. Never kill processes by name.

## Gotchas

- Every app's `.env` has a real WalletConnect project ID, so a `WalletConnect` row (platform `—`) always appears and AppKit reaches the network. Offline, AppKit logs console errors, and the `e2e/fixtures` console-error assertion fails. That failure is environmental, not a regression. Re-run online before you report it.
- Sonner toasts disappear after about 4 s. Assert on them and call `snap` immediately after the click.
- The `Sign` button is disabled while Kheopskit hydrates. Wait for `toBeEnabled()` before you click it.
- The Wagmi block auto-selects any EIP-6963 connector (`Active connector: Mock Ethereum Wallet`) even when that wallet is not connected in Kheopskit. Do not read that line as proof of a Kheopskit connection.
- `pnpm build:packages` rewrites `packages/*/dist`. A running `tsdown --watch` writes to the same directory. That is harmless, but the last writer wins.
