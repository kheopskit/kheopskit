---
"kheopskit": major
"@kheopskit/core": major
"@kheopskit/react": major
---

Placeholders restored from the cache carry `isPlaceholder: true`, and each platform account and wallet type is a union on it.

- Reading `account.txCreator` (or `polkadotSigner`), `account.signRaw`, `account.client`, `account.signer`, `account.getSigner`, `wallet.provider`, `wallet.wallet` or the WalletConnect wallet's `appKit` without narrowing on `isPlaceholder` is a compile error, and `wallet.sourceId` becomes `string | undefined`.
- A placeholder wallet's `connect()` waits for the live wallet and connects it, rejecting `WALLET_PENDING` if hydration ends first and `ABORTED` if its signal fires. Its `disconnect()` resolves at once. `PendingWalletError` is removed.
- A cached wallet present in the live registry is not a placeholder and carries its live handle.
