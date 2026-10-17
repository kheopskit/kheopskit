# Persistence and reload

Kheopskit remembers discovered wallets, connected accounts, and which wallets to reconnect. After a reload, the Wallets and Accounts tables show the cached state from the very first painted frame. Connected wallets then auto-reconnect without a prompt, and the list neither flashes empty nor reorders. vite-react persists to `localStorage`. nextjs-react and tanstack-start persist to a cookie, so the server renders the same state.

## Sub-features

- `persist-storage` writes `localStorage["kheopskit"]` = `{ remembered, cachedWallets, cachedAccounts }` on vite-react.
- `persist-cookie` writes the `kheopskit` cookie in compact form `{ v, r, w, a }` on nextjs-react and tanstack-start (`localStorage` stays `null`).
- `auto-reconnect` reconnects the wallets listed in `remembered` / `r` after a reload, without a user action. The row reads `Connecting…` (button disabled) from the first frame until the reconnect settles, then `Disconnect`; a refused reconnect forgets the wallet and shows the error under its name.
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
- **Connecting label.** The `Connecting…` window is shorter than a locator poll. Register the `BUTTON_RECORDER` init script from `specs/persistence.spec.ts` before `page.goto`, and after the reload assert `labelSequence(page)` equals `["Connecting…", "Disconnect"]`.
- **Disconnect forgets.** Click `Disconnect`, poll until `(await readPersistedState(page)).remembered` no longer lists the wallet, then reload. The row shows `Connect`.
- **Frame-level checks.** For `no-empty-flash` and `no-reorder`, reuse `e2e/tests/no-flicker.spec.ts`. Its `RECORDER_SCRIPT` samples both tables every animation frame. Copy it into a `.verify/specs/` spec, or run the e2e spec itself through `pnpm test:e2e`.
- **Proof.** Keep the persisted JSON from before and after, plus the screenshots from before and after the reload.

## Gotchas

- Writes are debounced, and the playground sets `hydrationGracePeriod: 500`. Poll the storage. Do not read it right after the click.
- The cache is written only after `isHydrating` ends. Hydration ends at the grace period when the remembered wallet is absent or `autoReconnect` is off, when its reconnect settles otherwise, and at `hydrationTimeout` (default 3000 ms) at the latest. A wallet still `Connecting…` at write time keeps its previous cached entry and accounts, so a slow `__dotEnableDelayMs` never empties the cache.
- The cookie value is URI-encoded JSON. `readPersistedState` decodes it.
- A fresh Playwright context starts empty, so persistence holds only within one test. Do the reload inside the same test.
- On SSR apps, a hydration mismatch shows up as a `console.error`, and the fixture fails the test. That failure is the signal. Do not suppress it.
