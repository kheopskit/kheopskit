# Submit a transaction

The "Submitting a transaction" block sends a 0-value transfer from a selected account to a selected recipient on a selected network. A `Send` button appears once a network is selected and `From` and `To` share a platform (on Ethereum, `To` must have a hex address). The network itself does not gate it, and an Ethereum `Send` is disabled on a non-EVM network. Progress shows as toasts (Ethereum `Transaction submitted: <hash>` then `Transaction successful`, Polkadot `Transaction created` then `broadcasted` then `Transaction successful`, Solana `Transaction sent: <sig>`), and every platform shows a `View on block explorer` link.

## Sub-features

- `tx-autoselect` preselects the first account on the default network's platform as both `From` and `To`.
- `tx-ethereum` switches or adds the chain if needed, estimates gas, sends 0 ETH, and waits for the receipt.
- `tx-polkadot` submits `Balances.transfer_keep_alive` (value 0) and tracks it to `inBestBlock`.
- `tx-solana` sends a 0-lamport transfer through the kit signer, on mainnet.

## How to get to it (user POV)

- Connect a wallet, then in the `Submitting a transaction` card choose `Network`, `From`, and `To`, and click `Send`.

## Driving it with serve.sh and a real wallet

Preconditions:

- The mock path cannot prove this feature, because the mock wallets reject `eth_sendTransaction`, chain switching, and Solana transaction signing. Use the real-wallet path.
- `serve.sh start vite-react` printed `ready at http://localhost:4201`, and you opened it in a new claude-in-chrome tab.
- A wallet extension has an account whose name contains `Guardians` and holds enough native token for fees on the chosen network.

- **Connect.** Click `Connect` on the extension's Wallets row and approve in the extension. The Accounts table shows the `Guardians` account.
- **Select.** Open the `Network` combobox and pick a network. Then pick the `Guardians` account in the `From` and `To` comboboxes. A `Send` button appears.
- **Send.** Click `Send`. Before you approve in the extension popup, confirm that the signer name contains `Guardians`, then approve.
- **Result.** A toast reads `Transaction successful` (Ethereum and Polkadot) or `Transaction sent: <sig>` (Solana). A `View on block explorer` link appears. Open it and confirm the transaction exists on chain.
- **Proof.** Save screenshots of the filled form, the extension approval showing the signer name, the success toast, and the explorer page into `.verify/evidence/<timestamp>-<app>-real-submit-tx/`.

## Gotchas

- Never approve a signature unless the signer name contains `Guardians`. If it does not, stop and ask the user.
- These are real networks. Fees are spent even on a 0-value transfer.
- `Send` is absent when `From` and `To` do not share a platform. A Polkadot network with an Ethereum `From` still renders an Ethereum `Send`, disabled. Pick the network that matches the accounts.
- The Polkadot path reads chain metadata over a public RPC, so the first send on a network can take several seconds.
- Run `serve.sh stop <app>` when you are done.
