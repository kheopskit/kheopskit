# Persistence and reload

Kheopskit remembers discovered wallets, connected accounts, and which wallets to reconnect. After a reload, the Wallets and Accounts tables show the cached state from the very first painted frame. Connected wallets then auto-reconnect without a prompt, and the list neither flashes empty nor reorders. vite-react persists to `localStorage`. nextjs-react and tanstack-start persist to a cookie, so the server renders the same state.

## Sub-features

- `persist-storage` writes `localStorage["kheopskit"]` = `{ remembered, cachedWallets, cachedAccounts }` on vite-react.
- `persist-cookie` writes the `kheopskit` cookie in compact form `{ v, r, w, a }` on nextjs-react and tanstack-start (`localStorage` stays `null`).
- `auto-reconnect` reconnects the wallets listed in `remembered` / `r` after a reload, without a user action. Once the cache has recorded the connect (1 s after the state settles), the row reads `Connecting…` (button disabled) from the first frame until the reconnect settles, then `Disconnect`. A reconnect the user refuses (`USER_REJECTED`) forgets the wallet. Any other failure keeps it remembered. A refused or failed reconnect shows its error under the wallet name. An aborted one shows none.
- `no-empty-flash` keeps the Wallets table from rendering with zero rows after a reload when wallets were cached.
- `no-reorder` keeps the Accounts order (polkadot, ethereum, solana) in every frame while wallets reconnect.
- `disconnect-forgets` removes a disconnected wallet from `remembered` / `r`, so it stays disconnected after a reload.

## How to get to it (user POV)

- Connect wallets, then reload the page or open it in a new tab.

## Driving it with run.sh

Preconditions:

- A fresh context. Use vite-react for localStorage, and nextjs-react or tanstack-start for cookies and SSR.

- **Connect.** Connect the Ethereum mock. Its row shows `Disconnect`.
- **Persisted.** Run `await expect.poll(async () => JSON.stringify(await readPersistedState(page))).toContain("Mock Ethereum Wallet")`, then `saveJson(testInfo, "01-persisted", await readPersistedState(page))`. On nextjs-react, `cookie` contains `"r":["ethereum:xyz.kheopskit.mock"]` and `localStorage` is `null`.
- **Reload.** Run `await page.reload()`. Without a click, the Ethereum row shows `Disconnect` and the account row is visible. Call `snap(page, testInfo, "02-after-reload")`.
- **Connecting label.** `BUTTON_RECORDER` from `specs/persistence.spec.ts` samples the `mock-polkadot-wallet` row only. Set `window.__dotEnableDelayMs = 500` in an init script, register `BUTTON_RECORDER` before `page.goto`, connect the Polkadot mock, reload, and assert `labelSequence(page)` equals `["Connecting…", "Disconnect"]`. Without the delay the window lasts a few frames. `e2e/tests/reconnect-status.spec.ts` drives the same check on every app.
- **Disconnect forgets.** Click `Disconnect`, poll until `(await readPersistedState(page)).remembered` no longer lists the wallet, then reload. The row shows `Connect`.
- **Frame-level checks.** For `no-empty-flash` and `no-reorder`, run `e2e/tests/no-flicker.spec.ts` unchanged: `run.sh <app> e2e/tests/no-flicker.spec.ts`. Its `RECORDER_SCRIPT` samples both tables every animation frame.
- **Proof.** Keep the persisted JSON from before and after, plus the screenshots from before and after the reload.

## Gotchas

- `remembered` is written as soon as a connect succeeds and cleared as soon as `disconnect()` starts. `cachedWallets` and `cachedAccounts` are written 1 s after hydration ends and the state settles. Poll the storage. Do not read it right after the click.
- With nothing cached, `isHydrating` is `false` from the first `kheopskit$` emission; the provider's first render reads `true` until then. Otherwise hydration ends once the grace period (500 ms in the playground) has passed and every cached wallet has settled. A discovered wallet settles at once unless it hydrated as `connecting`, in which case it settles when connected with its accounts read (or with no cached accounts), disconnected with an error, or disconnected and not remembered. A cached wallet that has not been discovered holds hydration until discovery ends, 1100 ms after `load`. When every cached wallet is discovered and settled, hydration does not wait for `load`. `hydrationTimeout` (3000 ms) ends it whatever is pending. A wallet still `Connecting…` at write time keeps its previous cached entry and accounts, so a slow `__dotEnableDelayMs` never empties the cache.
- The cookie value is URI-encoded JSON. `readPersistedState` decodes it.
- A fresh Playwright context starts empty, so persistence holds only within one test. Do the reload inside the same test.
- On SSR apps, a hydration mismatch shows up as a `console.error`, and the fixture fails the test. That failure is the signal. Do not suppress it.
