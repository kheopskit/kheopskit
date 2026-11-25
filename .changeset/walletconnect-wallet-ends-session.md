---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Fixed: when the paired wallet ends the WalletConnect session, the WalletConnect wallet now turns `disconnected` and its accounts leave the list, and pairing again connects it. Before, it stayed `connected` with the session's accounts until a page reload, signing with them failed with `NO_SESSION`, and `disconnect()` changed nothing. The wallet's `platforms` now also leave out a namespace the live session doesn't carry.
