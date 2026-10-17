# Connect and disconnect

A user connects a wallet from its Wallets row. The row switches to `Disconnect`, its account count updates, and the wallet's accounts appear in the Accounts table. Disconnecting reverses all three changes. The Accounts table lists every connected account, sorted with Polkadot first, then Ethereum, then Solana.

## Sub-features

- `connect-wallet` changes the row button from `Connect` to `Disconnect` and sets the account count.
- `connect-pending` shows a disabled `Connecting…` button while the wallet's `enable()` is pending. Set `window.__dotEnableDelayMs` in an init script to widen the window on the Polkadot mock.
- `connect-error` shows the error message under the wallet name after a refused or failed connect.
- `accounts-list` adds one Accounts row per account, with platform, wallet, name (Polkadot only), shortened address, and chain ID (Ethereum only).
- `accounts-order` keeps the Accounts table sorted polkadot → ethereum → solana, whatever order the wallets were connected in.
- `disconnect-wallet` restores `Connect`, sets the count back to `0`, and removes the wallet's Accounts rows.

## How to get to it (user POV)

- Click `Connect` or `Disconnect` on a row in the `Wallets` card.
- Read the result in the `Accounts` card ("Lists all connected accounts").

## Driving it with run.sh

Preconditions:

- A fresh context with the mock wallets injected and nothing connected.

- **Connect.** For each platform, run `walletsTable(page).getByRole("row", { name: MOCK_WALLETS[p].wallet }).getByRole("button", { name: "Connect" }).click()`. The same row shows a `Disconnect` button and a cell with exact text `1`.
- **Account row.** Run `accountsTable(page).getByRole("row", { name: MOCK_WALLETS[p].account })`. Polkadot shows name `Mock Account` and `5GrwvaEF…oHGKutQY`. Ethereum shows `0xf39Fd6…fFb92266` and chain ID `1`. Solana shows `So111111…11111112`. The app keeps 8 characters at each end of an address.
- **Order.** Connect solana, then ethereum, then polkadot. The first cells of `accountsTable(page).locator("tbody tr")` read `polkadot`, `ethereum`, `solana`.
- **Persisted.** Run `saveJson(testInfo, "connected-state", await readPersistedState(page))`. `remembered` (localStorage) or `r` (cookie) lists the connected wallet IDs. `(await readPersistedState(page)).remembered` reads either backend.
- **Disconnect.** Click `Disconnect` on the row. The row shows `Connect` again, and the account row is no longer visible (`expect(accountRow).not.toBeVisible()`).
- **Proof.** Call `snap` after connecting and again after disconnecting.

## Gotchas

- Wallet names appear in both tables. An unscoped `getByRole("row", { name: /Mock Ethereum Wallet/ })` matches two rows.
- The Ethereum and Solana account rows are named after the wallet. The Polkadot account row is named after the account (`Mock Account`).
- `cell { name: "1", exact: true }` can also match the Ethereum chain ID cell. Scope it to the Wallets row.
- The mock wallets never emit account-change events, so they cannot prove that an account added or removed inside the extension propagates. That needs a real wallet.
