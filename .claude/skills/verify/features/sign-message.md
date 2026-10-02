# Sign a message

Each Accounts row has a `Sign` button that signs the text `Kheopskit rocks!` with that account's platform SDK handle. The resulting signature appears in a success toast (`Signature: …`). If signing fails, an error toast (`Error: …`) appears instead.

## Sub-features

- `sign-polkadot` signs bytes through `account.txCreator.signBytes`. The toast shows a hex signature.
- `sign-ethereum` signs through `account.client.signMessage` (viem → `personal_sign`). The toast shows a hex signature.
- `sign-solana` signs through `account.signer.modifyAndSignMessages` (Wallet Standard `solana:signMessage`). The toast shows a base58 signature.
- `sign-hydrating` keeps `Sign` disabled while Kheopskit is still hydrating.

## How to get to it (user POV)

- Connect a wallet in the `Wallets` card, then click `Sign` on its row in the `Accounts` card.

## Driving it with run.sh

Preconditions:

- The wallet for the platform is connected (see [connect-disconnect](./connect-disconnect.md)).
- Ready-made spec: `.claude/skills/verify/specs/sign-message.spec.ts` covers all three platforms.

- **Enabled.** Run `const sign = accountsTable(page).getByRole("row", { name: MOCK_WALLETS[p].account }).getByRole("button", { name: "Sign" })`, then `await expect(sign).toBeEnabled()`.
- **Sign Polkadot.** Run `await sign.click()`. The toast matches `/Signature: 0x(22){64}/`.
- **Sign Ethereum.** The toast matches `/Signature: 0x(11){65}/`.
- **Sign Solana.** The toast matches `/Signature: 1{64}/` (64 zero bytes in base58).
- **Proof.** Call `snap(page, testInfo, "02-signed")` immediately after the toast assertion. The `.aria.yml` contains `listitem: "Signature: …"`.
- **Real wallet.** Run `serve.sh start vite-react`, connect the extension in a new tab, and click `Sign`. Check that the extension's signer name contains `Guardians` before you approve. The toast shows a non-mock signature.

## Gotchas

- Toasts vanish after about 4 s. Take the snapshot right after the assertion.
- Several toasts stack when you sign repeatedly. Use `.first()` on `getByText`.
- With a real Polkadot extension, `signBytes` wraps the payload in `<Bytes>…</Bytes>`. The signature is valid only for that wrapped form.
