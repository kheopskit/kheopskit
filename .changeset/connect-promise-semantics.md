---
"kheopskit": major
"@kheopskit/core": major
"@kheopskit/react": major
---

`connect()` and `disconnect()` are safe to call from UI code.

- Removed error codes `WALLET_ALREADY_CONNECTED` and `WALLET_NOT_CONNECTED`: `connect()` on a connected wallet and `disconnect()` on a disconnected wallet resolve at once.
- New error codes `ABORTED`, `USER_REJECTED` and `CONNECT_FAILED`. Platform rejections are wrapped in a `KheopskitError` carrying `cause` and `walletId`.
- Concurrent `connect()` calls on one wallet share a single pending promise; the platform is asked once.
- `connect(options?: { signal?: AbortSignal })`: an abort rejects with `ABORTED`, a late handle is released and the wallet is neither connected nor remembered. No default timeout.
- `disconnect()` during a pending `connect()` aborts it and never waits for the extension prompt.
- `connect()` and `disconnect()` resolve only after `kheopskit$` has emitted the wallet's new `isConnected` value.
- `kheopskit$` no longer throttles by 16 ms. A synchronous burst is coalesced into one emission, so no emission shows a connected wallet with stale accounts.
