# Wallet discovery

When the playground loads, the Wallets table lists every wallet that Kheopskit discovers: Polkadot extensions (`window.injectedWeb3`), Ethereum wallets (EIP-6963), Solana wallets (Wallet Standard), and, when the app has a WalletConnect project ID, one WalletConnect row. Each row shows the platform, the icon and name, an account count, and a `Connect` button.

## Sub-features

- `discovery-polkadot` lists each `injectedWeb3` extension under platform `polkadot`.
- `discovery-ethereum` lists each EIP-6963 provider under platform `ethereum`, with its announced name and icon.
- `discovery-solana` lists each Wallet Standard wallet under platform `solana`.
- `discovery-walletconnect` shows a single `WalletConnect` row with platform `—` when a project ID is configured.
- `discovery-count` shows `0` accounts for every wallet that is not connected.
- `discovery-settled` shows `Looking for wallets…` above the table until the page fires `load`, then hides it. A Polkadot extension that injects before `load` but after the subscribe-anchored poll (0 to 1100 ms) is listed within a few frames of `load`, without a reload.

## How to get to it (user POV)

- Open the playground root `/`. The `Wallets` card ("Lists all wallets installed on your browser") is the first block.

## Driving it with run.sh

Preconditions:

- A fresh context with the mock wallets injected. The `test` fixture does this.

- **Load.** Run `await page.goto("/")`. The heading `/Kheopskit Playground/` and the text `Lists all wallets installed on your browser` are visible.
- **Polkadot row.** Run `walletsTable(page).getByRole("row", { name: /mock-polkadot-wallet/ })`. The row is visible, contains `polkadot`, and has a `Connect` button.
- **Ethereum row.** Use the row name `/Mock Ethereum Wallet/`. The row contains `ethereum` and a blue icon.
- **Solana row.** Use the row name `/Mock Solana Wallet/`. The row contains `solana` and a purple icon.
- **WalletConnect row.** Only with a project ID in the app's `.env`. Use the row name `/WalletConnect/`. Its first cell is `—`.
- **Counts.** Every row has a cell with exact text `0`: `row.getByRole("cell", { name: "0", exact: true })`.
- **Proof.** Run `snap(page, testInfo, "01-discovered")`. The ARIA snapshot lists three rows, four with a WalletConnect project ID.

## Driving `discovery-settled`

`e2e/tests/discovery-at-load.spec.ts` drives it on every app:

```bash
.claude/skills/verify/scripts/run.sh vite-react e2e/tests/discovery-at-load.spec.ts
```

- **Race.** The init script `e2e/mocks/late-wallet.js` injects `late-mock-wallet` 1500 ms after kheopskit's first `injectedWeb3` read, and inserts an image at `DOMContentLoaded`. The spec holds that image until the injection has happened, so `load` always fires after it. The injection is timed from that first read, not from `DOMContentLoaded`, because nextjs-react and tanstack-start subscribe 200 to 350 ms after `DOMContentLoaded`, which leaves too little margin past the 1100 ms poll.
- **Expected end state.** `Looking for wallets…` is visible until `load` and hidden after. The `late-mock-wallet` row appears no later than 300 ms after `load`.
- **Proof.** The spec attaches `discovery-timestamps.json` (registry reads, injection, `load`, first row frame, status shown and hidden) and logs the `load`-to-row delay.

## Gotchas

- `page.goto` waits for `load` by default, and `Looking for wallets…` is gone by then. To see the page before `load`, navigate with `{ waitUntil: "commit" }`.
- The Polkadot mock has no icon. Its row name is the extension key `mock-polkadot-wallet`, not a display name.
- On the real-wallet path, the list reflects the extensions installed in the user's Chrome. Assert only on wallets you know are there.
- Clicking `Connect` on the WalletConnect row opens the AppKit modal and needs a phone wallet. It is not provable on the mock path.
