---
"kheopskit": minor
"@kheopskit/core": minor
"@kheopskit/react": minor
---

Add `isDiscovering` to the kheopskit state, and read `window.injectedWeb3` again at window `load` (and 100 ms later) so Polkadot extensions that inject just before `load` are listed. `isDiscovering` is `true` until that `load` read has landed, `false` from the first emission when subscribing after `load`, and `true` on the server.
