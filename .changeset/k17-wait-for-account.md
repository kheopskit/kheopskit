---
"kheopskit": minor
"@kheopskit/core": minor
"@kheopskit/react": minor
---

Added: `createKheopskit` returns `waitForAccount(accountId, { signal })`, which resolves with the live account once the running instance lists it, rejects `ACCOUNT_UNAVAILABLE` when the account's wallet settled without listing it, and rejects `ABORTED` like a wallet's `connect()`. `@kheopskit/react`'s `createKheopskit` returns it too.
