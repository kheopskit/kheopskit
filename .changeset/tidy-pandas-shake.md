---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Fix broken type declarations published in `@kheopskit/react@5.1.1`, where `useAccounts()` collapsed to `any` and `useWallets()` referenced undeclared identifiers. Consumers saw a wave of `TS7006: Parameter implicitly has an 'any' type` errors on accounts and wallets.
