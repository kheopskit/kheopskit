# Sign a message

Each Accounts row has a `Sign` button that signs the text `Kheopskit rocks!` with that account's platform SDK handle. The resulting signature appears in a success toast (`Signature: …`). If signing fails, an error toast (`Error: …`) appears instead.

## Sub-features

- `sign-polkadot` signs bytes through `account.txCreator.signBytes` (`polkadotSigner.signBytes` on polkadot-api 2). The toast shows a hex signature.
- `sign-in-polkadot` signs a Sign-In With Substrate text through `account.signRaw` with the `Sign in` button that Polkadot rows have next to `Sign`. The toast shows a hex signature.
- `sign-ethereum` signs through `account.client.signMessage` (viem → `personal_sign`). The toast shows a hex signature.
- `sign-solana` signs through `account.signer.modifyAndSignMessages` (Wallet Standard `solana:signMessage`). The toast shows a base58 signature.
- `sign-hydrating` keeps `Sign` and `Sign in` disabled while Kheopskit is still hydrating.

## How to get to it (user POV)

- Connect a wallet in the `Wallets` card, then click `Sign` on its row in the `Accounts` card.

## Driving it with run.sh

Preconditions:

- The wallet for the platform is connected (see [connect-disconnect](./connect-disconnect.md)).
- Ready-made spec: `.claude/skills/verify/specs/sign-message.spec.ts` covers all three platforms.

- **Enabled.** Run `const sign = accountsTable(page).getByRole("row", { name: MOCK_WALLETS[p].account }).getByRole("button", { name: "Sign", exact: true })`, then `await expect(sign).toBeEnabled()`. `exact` matters on Polkadot rows, where `Sign in` also matches `Sign`.
- **Sign Polkadot.** Run `await sign.click()`. The toast matches `/Signature: 0x(22){64}/`.
- **Sign Ethereum.** The toast matches `/Signature: 0x(11){65}/`.
- **Sign Solana.** The toast matches `/Signature: 1{64}/` (64 zero bytes in base58).
- **Sign in Polkadot.** Run `await accountRow.getByRole("button", { name: "Sign in" }).click()`. The toast matches `/Signature: 0x(22){64}/`. The mock records every `signRaw` payload on `window.__dotSignRawArgs`; the last entry is `{ address, data, type }` with `data` the SIWS text (`<host> wants you to sign in with your Substrate account:`, the address, `Kheopskit sign-in`, `URI: <origin>`, `Version: 1.0.0`, a `Nonce` and an `Issued At` line) and `type` `"payload"`, the value a string gets when the caller passes no `type`. The version must be the semver `1.0.0`: Talisman's SIWS parser rejects `1` and falls back to its generic Sign Request screen (live receipt, Talisman 3.11.0). Save it with `saveJson(testInfo, "signraw-args", payload)`.
- **Proof.** Call `snap(page, testInfo, "02-signed")` immediately after the toast assertion, and `03-signed-in` after the `Sign in` toast. The `.aria.yml` contains `listitem: "Signature: …"`.
- **Real wallet.** Run `serve.sh start vite-react`, connect the extension in a new tab, and click `Sign`. Check that the extension's signer name contains `Guardians` before you approve. The toast shows a non-mock signature. `Sign in` sends the SIWS text as plain text, so the extension shows it as a sign-in request (Talisman opens its Sign In screen).

## Gotchas

- Toasts vanish after about 4 s. Take the snapshot right after the assertion.
- Several toasts stack when you sign repeatedly. Use `.first()` on `getByText`.
- `signBytes` sends the hex payload with `type: "bytes"`. A real Polkadot extension such as Talisman wraps it in `<Bytes>…</Bytes>` before signing, so the signature is valid only for that wrapped form.
