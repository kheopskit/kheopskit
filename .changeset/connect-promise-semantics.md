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
- `disconnect()` during a `connect()` the platform has not granted aborts it and never waits for the extension prompt. A `disconnect()` that completes while a granted `connect()` still waits for the state rejects that connect `ABORTED`; if the platform's disconnect is still pending or refuses, the connect resolves once the state shows the wallet connected (today only Solana has a platform disconnect). A waiting `disconnect()` is resolved by a `connect()`.
- `connect()` resolves only after `kheopskit$` has emitted the wallet with `isConnected: true`; `disconnect()` after `isConnected: false`, or once a later `connect()` or the end of the subscription makes that emission impossible. After the last subscriber has unsubscribed, `connect()` and `disconnect()` on a wallet from that subscription reject `ABORTED` without asking the platform or changing the remembered list.
- `disconnect()` forgets the wallet before asking the platform and remembers it again if the platform refuses. A `connect()` queued behind a pending `disconnect()` rejects `ABORTED` as soon as its `signal` fires or the last subscriber unsubscribes.
- Persistence is best-effort: a storage write that throws keeps the in-memory state while the store is observed and never rejects `connect()` or `disconnect()`.
- Wallet objects keep their identity across emissions that only change accounts.
- `kheopskit$` no longer throttles by 16 ms. A synchronous burst is coalesced into one emission, so no emission shows a disconnected wallet still listing accounts. Until a fix tracked for 6.0.0 lands, an Ethereum wallet that reconnects while another connected Ethereum wallet's `eth_accounts` request is pending may show the accounts of its previous connection for as long as that request goes unanswered, and `connect()` may resolve on that emission. On platforms that list accounts asynchronously (Ethereum `eth_accounts`) the accounts may arrive in an emission after `connect()` resolved.
- A `connect()` whose wallet disappears before the platform grants it (extension removed, Wallet Standard unregister) rejects `ABORTED`; granted first, it resolves and the wallet stays remembered. A `disconnect()` waiting for the state resolves; one still waiting for the platform settles when the platform answers.
- Fixed: with two connected wallets, disconnecting one no longer leaves its accounts in the state while the other wallet's accounts are being re-read.
