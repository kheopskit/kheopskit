---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Fixed: `signRaw` on a Polkadot account connected over WalletConnect now targets a chain the session approved for that account and for `polkadot_signMessage`, preferring the order of the configured networks. Before, it always targeted the first configured network, so wallets that did not approve that network rejected the request.
