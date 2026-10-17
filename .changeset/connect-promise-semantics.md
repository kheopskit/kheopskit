---
"kheopskit": major
"@kheopskit/core": major
"@kheopskit/react": major
---

`connect()` and `disconnect()` are safe to call from UI code.

- Removed error codes `WALLET_ALREADY_CONNECTED` and `WALLET_NOT_CONNECTED`: `connect()` on a connected wallet and `disconnect()` on a disconnected wallet resolve at once.
- New error codes `ABORTED`, `USER_REJECTED` and `CONNECT_FAILED`. A platform's connect rejection is wrapped in a `KheopskitError` carrying `cause` and `walletId`.
- Concurrent `connect()` calls on one wallet share a single platform attempt; the platform is asked once. Each call gets its own promise.
- `connect(options?: { signal?: AbortSignal })`: an abort before the platform answers rejects that caller with `ABORTED` and leaves the other callers waiting. An abort after the platform granted the connect changes nothing, and a Polkadot extension counts as granted only once its account list has been read. Once no caller waits, kheopskit drops a late handle without revoking the platform's grant, and the wallet is neither connected nor remembered. No default timeout.
- `disconnect()` during a `connect()` the platform has not granted aborts it and never waits for the extension prompt. A `disconnect()` that completes while a granted `connect()` still waits for the state rejects that connect `ABORTED`; if the platform's disconnect is still pending or refuses, the connect resolves once the state shows the wallet connected (today only Solana has a platform disconnect). A waiting `disconnect()` is resolved by a `connect()`.
- `connect()` resolves once `kheopskit$` has emitted the wallet with `isConnected: true`, or once the wallet has left the list after the platform granted it. `disconnect()` resolves, after the platform has answered its disconnect, once `kheopskit$` has emitted `isConnected: false`, or once a later `connect()`, the wallet leaving the list or the end of the subscription makes that emission impossible. After the last subscriber has unsubscribed, `connect()` and `disconnect()` on an injected wallet from that subscription reject `ABORTED` without asking the platform or changing the remembered list. A placeholder's `connect()` rejects the same way and its `disconnect()` resolves; the WalletConnect connector is not wrapped and still calls AppKit.
- `disconnect()` forgets the wallet before asking the platform and remembers it again if the platform refuses. A `connect()` queued behind a pending `disconnect()` rejects `ABORTED` as soon as its `signal` fires or the last subscriber unsubscribes.
- Persistence is best-effort: a storage write that throws keeps the in-memory state while the store is observed and never rejects `connect()` or `disconnect()`.
- Wallet objects keep their identity across emissions that only change accounts.
- `kheopskit$` no longer throttles by 16 ms. A synchronous burst is coalesced into one emission, so no emission shows a disconnected wallet still listing live accounts (cached placeholder accounts stay listed during hydration). On platforms that list accounts asynchronously (Ethereum `eth_accounts`) the accounts may arrive in an emission after `connect()` resolved.
- A `connect()` whose wallet disappears before the platform grants it (extension removed, Wallet Standard unregister) rejects `ABORTED`; granted first, it resolves and the wallet stays remembered. A `disconnect()` waiting for the state resolves; one still waiting for the platform settles when the platform answers.
- Fixed: with two connected wallets, disconnecting one no longer leaves its accounts in the state while the other wallet's accounts are being re-read.
