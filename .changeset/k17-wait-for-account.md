---
"kheopskit": minor
"@kheopskit/core": minor
"@kheopskit/react": minor
---

Added: `createKheopskit` returns `waitForAccount(accountId, { signal })`, which resolves with the live account once the running instance lists it, rejects `ACCOUNT_UNAVAILABLE` when the account's wallet settled listing other accounts but not this one or is not connected (a connected wallet that lists no accounts keeps the wait open until `signal` fires), and rejects `ABORTED` like a wallet's `connect()`. `@kheopskit/react`'s `createKheopskit` returns it too.
