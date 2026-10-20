---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Fixed: wallets and accounts cached for a platform missing from `platforms` no longer show on the first frame, in the SSR markup or as hydration placeholders. The cached WalletConnect row and its accounts likewise need `walletConnect` in the config, and a WalletConnect account needs its platform in `platforms`. Remembered wallets of a removed platform are not reconnected and stay remembered, so adding the platform back restores their reconnect.
