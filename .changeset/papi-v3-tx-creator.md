---
"kheopskit": minor
"@kheopskit/core": minor
"@kheopskit/react": minor
---

Support polkadot-api v3 alongside v2.

polkadot-api v3 replaced the `PolkadotSigner` interface with `TxCreator`: injected accounts now expose `txCreator` instead of `polkadotSigner`, and `getPolkadotSignerFromPjs` became `getTxCreatorFromPjs`. `@kheopskit/core` detects which one the installed `polkadot-api/pjs-signer` provides at runtime, so `PolkadotAccount` carries `txCreator` on v3 and `polkadotSigner` on v2, for both injected and WalletConnect accounts. The `polkadot-api` peer range stays `>=2.0.0`; apps on v2 are unaffected.

Adds the `UNSUPPORTED_VERSION` error code, thrown when neither factory is found.
