---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Fixed: a wallet whose account stream errors, such as an extension whose `accounts.subscribe` throws, no longer stops `kheopskit$`. That wallet lists no accounts, kheopskit logs a warning, and every other wallet keeps its accounts and updates.
