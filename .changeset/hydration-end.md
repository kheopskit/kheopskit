---
"kheopskit": minor
"@kheopskit/core": minor
"@kheopskit/react": minor
---

Hydration ends as soon as the facts allow, and persistence never writes an empty cache for a wallet still connecting.

- `isHydrating` turns `false` once `hydrationGracePeriod` has elapsed, discovery has ended (`isDiscovering` is `false`), and every wallet that hydrated as `connecting` has settled. A wallet has settled when it is absent from the discovered wallets, connected once its account list has been read (an empty list counts; a custom platform plugin not built on kheopskit's account engine settles on its first listed account instead, as in 5.x) or connected with no cached accounts, disconnected with `error` set, or disconnected and not remembered when hydration began. At `hydrationTimeout` hydration ends whatever is pending, and a wallet whose reconnect is still pending stays `connecting`.
- Discovery ends only after the page fires `load`, so a page with a cache hydrates until `load` or `hydrationTimeout`, whichever comes first, even when no wallet reconnects. With the extension gone, hydration no longer runs to 3 s. It ends once the grace period has elapsed and the page has loaded, or at `hydrationTimeout` if that comes first. MIGRATING_TO_V6.md section 8 lists the cases that hold hydration until the timeout.
- New `hydrationTimeout` option (default 3000 ms). `hydrationTimeout` replaces the old cap of six times `hydrationGracePeriod` and wins over a longer grace period, so an app that raised `hydrationGracePeriod` sets `hydrationTimeout` as well.
- When the cache is written, a wallet whose `status` is `connecting` keeps its previous cached entry and accounts. Every other wallet is written from live data.
