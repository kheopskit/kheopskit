# Submit a transaction

The "Submitting a transaction" block sends a 0-value transfer from a selected account to a selected recipient on a selected network. A `Send` button appears once a network is selected and either `From` is an Ethereum account and `To` has a hex address (on any platform), or `From` and `To` are both Polkadot or both Solana accounts. An Ethereum `Send` is enabled only on a network that viem knows (`Ethereum` and `Base`). It is disabled on `Polkadot Asset Hub`, `Polkadot Asset Hub (EVM)`, and `Solana`. Progress shows as toasts (Ethereum `Transaction submitted: <hash>` then `Transaction successful`, Polkadot `Transaction created: <hash>` then `Transaction broadcasted: <hash>` then `Transaction successful`, Solana `Transaction sent: <sig>`). The Polkadot toasts replace each other in place, and the final one carries no hash. Ethereum shows a `View on block explorer` link when viem knows the chain, and Solana always shows one. Polkadot shows none, because the block looks its explorer up by the papi chain key among AppKit network ids and never finds a match.

## Sub-features

- `tx-autoselect` preselects the first account on the default network's platform as both `From` and `To`.
- `tx-ethereum` switches or adds the chain if needed, estimates gas, sends 0 ETH, and waits for the receipt.
- `tx-polkadot` submits `Balances.transfer_keep_alive` (value 0) and tracks it to `inBestBlock`.
- `tx-solana` sends a 0-lamport transfer through the kit signer, on mainnet, whatever network is selected.

## How to get to it (user POV)

- Connect a wallet, then in the `Submitting a transaction` card choose `Network`, `From`, and `To`, and click `Send`.

## Driving it with run.sh and serve.sh

Preconditions:

- Mock path: a fresh context with nothing connected. It proves the form (autoselect, the `Send` gating, the error toasts), not a submitted transaction. Scope to `const card = page.locator("div", { has: page.getByText("Demo transfer: selected account will send 0 tokens") }).filter({ has: page.getByRole("combobox") }).last()`.
- Real wallet: `serve.sh start vite-react` printed `ready at http://localhost:4201`, and you opened it in a new claude-in-chrome tab. A wallet extension has an account whose name contains `Guardians` and holds enough native token for fees on the chosen network.

- **Comboboxes.** The labels `Network`, `From`, and `To` are not tied to their triggers, so each combobox is named after its current value or placeholder. Use `card.getByRole("combobox").nth(0)` for Network, `.nth(1)` for From, and `.nth(2)` for To. They read `Polkadot Asset Hub`, `Account`, and `Recipient`, and there is no `Send` button.
- **Autoselect.** Connect the Polkadot mock. From and To both read `[mock-polkadot-wallet] Mock Account`, and `Send` is enabled.
- **Ethereum gating.** Connect the Ethereum mock and pick `[Mock Ethereum Wallet] 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` as From and To. `Send` is enabled on `Ethereum` and `Base`, and disabled on `Polkadot Asset Hub`, `Polkadot Asset Hub (EVM)`, and `Solana`. Pick `Polkadot Asset Hub` with an exact match, because `Polkadot Asset Hub (EVM)` contains it. Pick `[mock-polkadot-wallet] Mock Account` as To, and `Send` disappears.
- **Mock send errors.** On `Ethereum`, `Send` with the Ethereum mock toasts `Error: An unknown RPC error occurred.`. With the Solana mock as From and To, `Send` toasts `Error: [kheopskit] wallet "Mock Solana Wallet" does not support solana:signAndSendTransaction`. Both read a public RPC first, so they need network access. Avoid `Base` and Polkadot sends on the mock path: they log `console.error` and fail the fixture.
- **Connect (real wallet).** Click `Connect` on the extension's Wallets row and approve in the extension. The Accounts table shows the `Guardians` account.
- **Select (real wallet).** Pick a network in the first combobox, then the `Guardians` account in the second (From) and third (To). A `Send` button appears. Autoselect already picks the first account of the default network's platform, which may not be a `Guardians` one.
- **Send (real wallet).** Click `Send`. Before you approve in the extension popup, confirm that the signer name contains `Guardians`, then approve.
- **Result (real wallet).** A toast reads `Transaction successful` (Ethereum and Polkadot) or `Transaction sent: <sig>` (Solana). On Ethereum and Solana a `View on block explorer` link appears; open it and confirm the transaction exists on chain. On Polkadot no link appears, and `Transaction successful` replaces the toast that held the hash. Screenshot the `Transaction created: <hash>` or `Transaction broadcasted: <hash>` toast as soon as it shows, then look the hash up on an explorer such as Subscan.
- **Proof (real wallet).** Save screenshots of the filled form, the extension approval showing the signer name, the success toast, and the explorer page into `.verify/evidence/<timestamp>-<app>-real-submit-tx/`.

## Gotchas

- Never approve a signature unless the signer name contains `Guardians`. If it does not, stop and ask the user.
- These are real networks. Fees are spent even on a 0-value transfer.
- With a Polkadot or Solana `From`, `Send` is absent unless `To` is on the same platform. With an Ethereum `From`, any hex `To` renders `Send`, including a Polkadot account of type `ethereum`. Pick `Ethereum` or `Base` for an Ethereum send.
- `Send` does nothing, with no toast, while the selected account is a hydration placeholder. After a reload, wait for the wallet to read `Disconnect` before you click it.
- Talisman 3.11.0 exposes no `signer.createTransaction`, so Kheopskit builds Polkadot transactions from its `signPayload`.
- The Polkadot path reads chain metadata over a public RPC, so the first send on a network can take several seconds.
- Run `serve.sh stop <app>` when you are done.
