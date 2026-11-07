---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Fixed: an injected Ethereum wallet's accounts and chain show in the same `kheopskit$` emission that shows the wallet connected, on a user connect and on a reload's reconnect, instead of one emission later. A wallet's late `eth_accounts` or `eth_chainId` answer no longer overwrites an `accountsChanged`, `chainChanged` or `connect` event sent after it was asked. A connect no longer waits forever for a wallet that never answers `eth_chainId`: after 2 seconds its accounts show without a chain.
