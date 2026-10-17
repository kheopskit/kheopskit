---
"kheopskit": major
"@kheopskit/core": major
"@kheopskit/react": major
---

Every wallet carries a `status` and its last connect `error`, and `autoReconnect` takes a predicate.

- `BaseWallet.status` is `"disconnected" | "connecting" | "connected"`; `isConnected` is `status === "connected"`. `connecting` covers a `connect()` call and an auto-reconnect alike. `BaseWallet.error` holds the last `USER_REJECTED` or `CONNECT_FAILED` and is cleared when the next attempt starts. The WalletConnect connector carries the same fields.
- `autoReconnect: boolean | ((wallet: BaseWallet) => boolean)` governs injected wallets. The function must be synchronous and pure; it decides per remembered injected wallet. Every successful connect is still remembered, whatever this option says. The WalletConnect row follows AppKit's own session restore and hydrates `connecting` while AppKit restores.
- A reconnect the user refuses forgets the wallet, so the next load does not prompt again. Other failures set `error`, keep the wallet remembered and are retried on later discovery changes, 3 attempts in total. A manual `connect()` or `disconnect()` on a remembered wallet ends its automatic reconnect for the session. A `disconnect()` while the automatic reconnect still waits for the extension aborts it without forgetting the wallet, so the next load reconnects it. Automatic reconnect also ends when the wallet disappears mid-attempt; the wallet stays remembered for the next load. Nothing is written to `console.error`.
- On a reload, a cached connected wallet shows `status: "connecting"` with `isConnected: false` from the first frame until its reconnect settles; one the predicate rejects shows `disconnected` without its cached accounts. No emission shows `isConnected: true` with a status other than `connected`.
- `getHydratedSnapshot(store, config, options)` takes the resolved config (`platforms` and `autoReconnect`) in place of the platforms array.
