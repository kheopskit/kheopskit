---
"kheopskit": major
"@kheopskit/core": major
"@kheopskit/react": major
---

Placeholders restored from the cache carry `isPlaceholder: true`, and each platform account and wallet type is a union on it.

- Reading `account.txCreator` (or `polkadotSigner`), `account.signRaw`, `account.client`, `account.signer`, `account.getSigner`, `wallet.provider`, `wallet.wallet` or the WalletConnect wallet's `appKit` without narrowing on `isPlaceholder` yields a possibly-`undefined` value, so calling it or using it as present fails to compile, and `wallet.sourceId` becomes `string | undefined`.
- A placeholder wallet's `connect()` waits for the live wallet and connects it, rejecting `WALLET_PENDING` if hydration ends first and `ABORTED` if its signal fires or the subscription ends. Its `disconnect()` resolves at once. `PendingWalletError` is removed.
- A cached wallet present in the live registry is not a placeholder and carries its live `connect()` and `disconnect()`. A Polkadot wallet's `extension` stays `undefined` until its reconnect succeeds.
