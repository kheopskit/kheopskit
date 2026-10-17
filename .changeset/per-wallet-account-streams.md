---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Fixed: each wallet's accounts are read on their own stream, started empty when the wallet connects and ended when it disconnects. A wallet that reconnects never shows the accounts of its previous connection and `connect()` never resolves on such an emission; one wallet's pending `eth_accounts` request no longer delays another wallet's accounts or account changes; a wallet connecting or disconnecting no longer makes its siblings re-read their accounts; a Polkadot extension's `accounts.subscribe` runs once per connection.
