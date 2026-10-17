---
"kheopskit": major
"@kheopskit/core": major
"@kheopskit/react": major
---

Polkadot raw signing and the injected handle:

- `account.signRaw(data, options?)` signs a string as text or a `Uint8Array` as hex with the wallet's raw signing call (`signer.signRaw` for an extension, `polkadot_signMessage` over WalletConnect) and resolves the hex signature. `options.type` defaults to `"bytes"`.
- `wallet.extension` is the raw object `enable()` returned, typed as `PolkadotInjected`, instead of pjs-signer's `InjectedExtension`. kheopskit calls `enable()` itself.
- `ethereum` accounts get their `txCreator` (or `polkadotSigner` on polkadot-api v2) built with the `ecdsa` signature type, so fee estimation and dry runs use a 65-byte mock signature.
- The extension's account subscription is released on disconnect and when the last subscriber leaves.
- `readonly` and `partOfPortfolio`, which Talisman adds for its own dapp origins, are typed as optional booleans on `PolkadotAccount`.
