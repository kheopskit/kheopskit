# Usage with Wagmi

The "Usage with Wagmi" block shows that Ethereum wallets discovered by Kheopskit are also available to Wagmi. It lists Wagmi's connectors and the active connector and account. A "Best practice" sub-block signs `Hello Wagmi!` with the `client` of a chosen Kheopskit Ethereum account, without switching Wagmi's active connector.

## Sub-features

- `wagmi-connectors` lists a button per EIP-6963 connector. The active connector's button is disabled and green.
- `wagmi-active` shows `Active connector: <name>` and `Active account: <address>`.
- `wagmi-sign` signs through a Kheopskit Ethereum account picked from the `Account` select. The toast shows `Signature: …`.

## How to get to it (user POV)

- Scroll to the `Usage with Wagmi` card. Click a connector button, or pick an account in the `Account` select and click `Sign`.

## Driving it with run.sh

Preconditions:

- The Ethereum mock is connected in the `Wallets` card (see [connect-disconnect](./connect-disconnect.md)).

- **Connectors.** `page.getByRole("button", { name: /Mock Ethereum Wallet/ })` inside the Wagmi card is visible.
- **Active account.** The text `Active account: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` is visible.
- **Pick account.** Click `card.getByRole("combobox")` (see Gotchas for `card`), then `page.getByRole("option", { name: /Mock Ethereum Wallet - 0xf39F/ })`. The `Sign` button next to it becomes enabled.
- **Sign.** Click that `Sign` button. The toast matches `/Signature: 0x(11){65}/`.
- **Proof.** Call `snap` after picking the account and after the toast.

## Gotchas

- Wagmi auto-selects any announced EIP-6963 connector, so `Active connector: Mock Ethereum Wallet` appears even when the wallet is not connected in Kheopskit. That line is not proof of a Kheopskit connection.
- The page has `Sign` buttons in both the Accounts rows and this card. Scope to the card with `const card = page.locator("div", { has: page.getByText("Best practice with Kheopskit") }).last()`, then use `card.getByRole("combobox")` and `card.getByRole("button", { name: "Sign" })`.
- The `Account` select lists only Ethereum accounts, labelled `<walletName> - <address>`.
