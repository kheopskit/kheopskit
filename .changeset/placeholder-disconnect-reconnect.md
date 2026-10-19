---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Fixed: a remembered wallet forgotten before it injects is no longer reconnected when it does. A placeholder's `disconnect()` now forgets the wallet, or calls the live wallet's `disconnect()` once that one is discovered. `store.forgetWallet(walletId)` during the session cancels the automatic reconnect for good, even if the wallet is remembered again. A wallet the user disconnects after its reconnect was granted no longer holds `isHydrating` until `hydrationTimeout`.
