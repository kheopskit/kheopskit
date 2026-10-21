---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Fixed: with `walletConnect`, `wallets` lists the injected wallets without waiting for Reown AppKit to download and start. The WalletConnect wallet joins the list once AppKit loads, and `isDiscovering` still stays `true` until then.
