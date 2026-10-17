---
"kheopskit": major
"@kheopskit/core": major
"@kheopskit/react": major
---

Polkadot raw signing and the injected handle:

- `account.signRaw(data, options?)` signs a string as text or a `Uint8Array` as hex with the wallet's raw signing call (`signer.signRaw` for an extension, `polkadot_signMessage` over WalletConnect) and resolves the hex signature. With no `options.type`, a string is sent with `type: "payload"` and a `Uint8Array` with `type: "bytes"`; an explicit `options.type` is sent as given. A hex-looking string is sent as text; pass a `Uint8Array` for bytes. Talisman's Sign In screen follows text `data`; Enkrypt reads `type` as the encoding of `data` and so needs the matching value.
- `wallet.extension` is the raw object `enable()` returned, typed as `PolkadotInjected`, instead of pjs-signer's `InjectedExtension`. kheopskit calls `enable()` itself.
- `ethereum` accounts get their `txCreator` built with the `ecdsa` signature type, so fee estimation and dry runs use a 65-byte mock signature. polkadot-api v2's `getPolkadotSignerFromPjs` ignores the signature type, so `polkadotSigner` is unchanged.
- The extension's account subscription is released on disconnect and when the last subscriber leaves.
- Accounts the extension lists without a `type` are now kept as `sr25519`; `polkadot({ accountTypes })` is the only filter.
- `connect()` rejects `CONNECT_FAILED` (with an `Error` naming the extension as `cause`) when the `enable()` result lacks `accounts.get`, `accounts.subscribe`, `signer.signPayload` or `signer.signRaw`, or when `accounts.get()` rejects (a rejection whose message matches a known refusal maps to `USER_REJECTED`), and an account kheopskit cannot build is skipped instead of stalling the wallet's list.
- `readonly` and `partOfPortfolio`, which Talisman adds for its own dapp origins, are typed as optional booleans on `PolkadotAccount`.
