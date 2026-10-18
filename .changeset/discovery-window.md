---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Fixed: Polkadot discovery now reads `window.injectedWeb3` at `load` and 100, 300, 600 and 1100 ms after it, as it already did after subscribe. `isDiscovering` is `true` until the last read, 1100 ms after `load` or after subscribe, whichever is later, so no read is pending once it turns `false`, and that emission lists every extension injected by then. A subscription that starts after `load` no longer reads `false` from its first emission. On the server, the registry is read once and no timer is set.

Hydration waits for discovery only while a cached wallet has not been discovered. When every cached wallet is discovered and settled, `isHydrating` ends at the grace period without waiting for `load`.
