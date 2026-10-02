# Wallet discovery

When the playground loads, the Wallets table lists every wallet that Kheopskit discovers: Polkadot extensions (`window.injectedWeb3`), Ethereum wallets (EIP-6963), Solana wallets (Wallet Standard), and one WalletConnect row. Each row shows the platform, the icon and name, an account count, and a `Connect` button.

## Sub-features

- `discovery-polkadot` lists each `injectedWeb3` extension under platform `polkadot`.
- `discovery-ethereum` lists each EIP-6963 provider under platform `ethereum`, with its announced name and icon.
- `discovery-solana` lists each Wallet Standard wallet under platform `solana`.
- `discovery-walletconnect` shows a single `WalletConnect` row with platform `—` when a project ID is configured.
- `discovery-count` shows `0` accounts for every wallet that is not connected.

## How to get to it (user POV)

- Open the playground root `/`. The `Wallets` card ("Lists all wallets installed on your browser") is the first block.

## Driving it with run.sh

Preconditions:

- A fresh context with the mock wallets injected. The `test` fixture does this.

- **Load.** Run `await page.goto("/")`. The heading `/Kheopskit Playground/` and the text `Lists all wallets installed on your browser` are visible.
- **Polkadot row.** Run `walletsTable(page).getByRole("row", { name: /mock-polkadot-wallet/ })`. The row is visible, contains `polkadot`, and has a `Connect` button.
- **Ethereum row.** Use the row name `/Mock Ethereum Wallet/`. The row contains `ethereum` and a blue icon.
- **Solana row.** Use the row name `/Mock Solana Wallet/`. The row contains `solana` and a purple icon.
- **WalletConnect row.** Use the row name `/WalletConnect/`. Its first cell is `—`.
- **Counts.** Every row has a cell with exact text `0`: `row.getByRole("cell", { name: "0", exact: true })`.
- **Proof.** Run `snap(page, testInfo, "01-discovered")`. The ARIA snapshot lists all four rows.

## Gotchas

- The Polkadot mock has no icon. Its row name is the extension key `mock-polkadot-wallet`, not a display name.
- On the real-wallet path, the list reflects the extensions installed in the user's Chrome. Assert only on wallets you know are there.
- Clicking `Connect` on the WalletConnect row opens the AppKit modal and needs a phone wallet. It is not provable on the mock path.
