# Migrating to Kheopskit v6

v6 changes how the Polkadot plugin talks to an extension. kheopskit calls
`enable()` itself, keeps the raw object the extension returns, and exposes raw
signing on every account.

`@kheopskit/core`, `@kheopskit/react` and the repo release tag move to
**`6.0.0`** together.

This guide grows with each v6 change. Each section covers one area.

---

## At a glance

| Area | v5 | v6 |
|------|----|----|
| `wallet.extension` on a Polkadot wallet | pjs-signer's `InjectedExtension` (`getAccounts`, `subscribe`, `disconnect`) | the raw `enable()` result, typed `PolkadotInjected` (`accounts`, `signer`) |
| Raw signing | `txCreator.signBytes(bytes)` only, hex with `type: "bytes"` | plus `account.signRaw(data, { type? })`, text or bytes |
| `ethereum` accounts | signer built with type `ethereum`, 64-byte mock signature | signer built with `ecdsa`, 65-byte mock signature |
| Extension account subscription | kept after disconnect | released on disconnect and on teardown |
| `readonly`, `partOfPortfolio` (Talisman, its own origins) | present at runtime, not typed | typed on `PolkadotAccount` |

---

## 2. Polkadot: raw signing and the injected handle

### `extension` is the raw `enable()` result

`PolkadotInjectedWallet.extension` is no longer pjs-signer's
`InjectedExtension`. It is the object `window.injectedWeb3[id].enable(appName)`
resolved to, typed structurally as `PolkadotInjected`:

```ts
type PolkadotInjected = {
  accounts: {
    get(): Promise<PolkadotInjectedAccount[]>;
    subscribe(cb: (accounts: PolkadotInjectedAccount[]) => void): () => void;
  };
  signer: { signPayload: SignPayload; signRaw(payload): Promise<{ id; signature }> };
  metadata?: unknown;
  provider?: unknown;
};
```

`getAccounts()`, `subscribe()` and `disconnect()` are gone from it. Read
accounts from `state.accounts`; kheopskit owns the subscription. The field is
`undefined` while the wallet is disconnected and while `state.isHydrating` is
`true`.

```diff
- const accounts = wallet.extension?.getAccounts() ?? [];
+ const accounts = state.accounts.filter((a) => a.walletId === wallet.id);
```

### `account.signRaw`

Every Polkadot account has
`signRaw(data: string | Uint8Array, options?: { type?: "bytes" | "payload" })`.
It resolves the hex signature. A string is sent as text and a `Uint8Array` as
`0x` hex. Injected accounts go through the extension's `signer.signRaw`,
WalletConnect accounts through `polkadot_signMessage`.

`options.type` is sent as given and defaults to `"bytes"`, the value
`txCreator.signBytes` sends. Pass it explicitly. Talisman, polkadot.js,
SubWallet and Nova ignore it and decode `data` by shape. Enkrypt reads it as the
encoding of `data`: `"payload"` means UTF-8 text, `"bytes"` means hex.

Talisman 3.11.0 opens its Sign In screen when the text parses as a SIWS
message and its generic Sign Request screen otherwise, hex included. The
`type` value plays no part in that choice: live receipts with the same text and
both values show the same screen. The SIWS `Version` line must read `1.0.0`;
Talisman's parser rejects `1` and falls back to the generic screen.

```ts
const signature = await account.signRaw(siwsMessage, { type: "payload" });
```

`txCreator.signBytes` is unchanged.

### `ethereum` accounts sign as `ecdsa`

For an account whose `type` is `"ethereum"`, kheopskit builds the `txCreator`
(or `polkadotSigner` on polkadot-api v2) with the `ecdsa` signature type.
pjs-signer's own map knows `ed25519`, `sr25519` and `ecdsa` only, so an
`ethereum` type got a 64-byte mock signature where ecdsa needs 65. Fee
estimation and dry runs for ethereum-format accounts no longer use the wrong
length.

### The account subscription is released

v5 subscribed to the extension's account list and never unsubscribed. v6
unsubscribes when the wallet disconnects and when the last `kheopskit$`
subscriber leaves.

### `readonly` and `partOfPortfolio`

Talisman adds these two fields to the accounts it shares with its own dapp
origins: `readonly` marks a watch-only account that cannot sign, and
`partOfPortfolio` a watch-only account that is part of the user's portfolio.
They are typed on `PolkadotInjectedAccount` and `PolkadotAccount` as optional
booleans and are absent for other origins and other wallets.

### polkadot-api v2

v2 still works. The account carries `polkadotSigner` instead of `txCreator`,
and the fourth factory argument (the signature type) is ignored by
`getPolkadotSignerFromPjs` at runtime.

### What to delete in your app

- A second `enable()` call made to reach `signer.signRaw` for a Sign-In With
  Substrate message. Call `account.signRaw(message)`.
- A hand-built `ecdsaTxCreator` for ethereum-format accounts, and a
  `signatureTypeOf` helper that maps `ethereum` to `ecdsa`.
- A memoised second `enable()` and a `pjsSignerOf` helper that rebuilds a pjs
  signer from the raw extension. Use `account.txCreator`.
- A `TalismanInjectedAccount` cast that adds `readonly` and `partOfPortfolio`.
  They are on `PolkadotAccount`.
