---
"kheopskit": major
"@kheopskit/core": major
"@kheopskit/react": major
---

Rename the persisted `autoReconnect` list to `remembered` (read-migrated) and the store methods to `rememberWallet`/`forgetWallet`; add a `storage` option and `destroy()` to `createKheopskitStore`; re-emit renamed accounts; keep each wallet's accounts in extension order. The store holds its cross-tab sync only while `store.observable` is observed. See MIGRATING_TO_V6.md.
