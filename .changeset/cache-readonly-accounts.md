---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Fixed: a cached Polkadot account keeps its `readonly` flag, so a watch-only account no longer reads as signable while its wallet reconnects. A cached Polkadot account written without a key type now hydrates as `sr25519`, like a live account that reports none.
