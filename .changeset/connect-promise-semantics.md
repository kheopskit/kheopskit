---
"kheopskit": major
"@kheopskit/core": major
"@kheopskit/react": major
---

`connect()` and `disconnect()` are safe to call from UI code.

- Removed error codes `WALLET_ALREADY_CONNECTED` and `WALLET_NOT_CONNECTED`: `connect()` on a connected wallet and `disconnect()` on a disconnected wallet resolve at once.
- New error codes `ABORTED`, `USER_REJECTED` and `CONNECT_FAILED`. Platform rejections are wrapped in a `KheopskitError` carrying `cause` and `walletId`.
- Concurrent `connect()` calls on one wallet share a single platform attempt; the platform is asked once. Each call gets its own promise.
- `connect(options?: { signal?: AbortSignal })`: an abort before the platform answers rejects that caller with `ABORTED` and leaves the other callers waiting. An abort after the platform granted the connect changes nothing. Once no caller waits, a late handle is released and the wallet is neither connected nor remembered. No default timeout.
- `disconnect()` during a pending `connect()` aborts it and never waits for the extension prompt. A `connect()` already granted but still waiting for the state is rejected `ABORTED` by a `disconnect()`; a waiting `disconnect()` is resolved by a `connect()`.
- `connect()` resolves only after `kheopskit$` has emitted the wallet with `isConnected: true`; `disconnect()` after `isConnected: false`, or once a later `connect()` or the end of the subscription makes that emission impossible. After the last subscriber has unsubscribed, `connect()` on a wallet from that subscription rejects `ABORTED` without asking the platform.
- Wallet objects keep their identity across emissions that only change accounts.
- `kheopskit$` no longer throttles by 16 ms. A synchronous burst is coalesced into one emission, so no emission shows a connected wallet with stale accounts.
