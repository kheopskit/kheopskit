---
"kheopskit": minor
"@kheopskit/core": minor
"@kheopskit/react": minor
---

Hydration ends as soon as the facts allow, and persistence never writes an empty cache for a wallet still connecting.

- `isHydrating` turns `false` once `hydrationGracePeriod` elapsed, `isDiscovering` is `false` and every remembered wallet kheopskit reconnects is settled (connected with its accounts read, failed with `error`, no longer remembered, or absent from the discovered wallets). With the extension gone it ends at the grace period, not at 3 s.
- New `hydrationTimeout` option (default 3000 ms): the upper bound on `isHydrating`, replacing the implicit cap of six times the grace period. A reconnect still pending when it elapses stays `connecting` past hydration end.
- When the cache is written, a wallet whose `status` is `connecting` keeps its previous cached entry and accounts; every other wallet is written from live data.
