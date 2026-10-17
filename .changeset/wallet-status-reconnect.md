---
"kheopskit": major
"@kheopskit/core": major
"@kheopskit/react": major
---

Every wallet carries a `status` and its last connect `error`, and `autoReconnect` takes a predicate.

- `BaseWallet.status` is `"disconnected" | "connecting" | "connected"`; `isConnected` is `status === "connected"`. `connecting` covers a `connect()` call and an auto-reconnect alike. `BaseWallet.error` holds the last `USER_REJECTED` or `CONNECT_FAILED` and is cleared when the next attempt starts. The WalletConnect connector carries the same fields.
- `autoReconnect: boolean | ((wallet: BaseWallet) => boolean)` governs injected wallets. The function must be synchronous and pure; it decides per remembered injected wallet. Every successful connect is still remembered, whatever this option says. The WalletConnect row follows AppKit's own session restore and hydrates `connecting` while AppKit restores.
- A reconnect the user refuses forgets the wallet, so the next load does not prompt again. Other failures set `error`, keep the wallet remembered and retry up to three times on later discovery changes. A manual `connect()` or `disconnect()` on a remembered wallet ends its automatic reconnect for the session, so a disconnect the user makes is never undone. Nothing is written to `console.error`.
- On a reload, a cached connected wallet shows `status: "connecting"` with `isConnected: false` from the first frame until its reconnect settles; one the predicate rejects shows `disconnected` without its cached accounts. No emission shows `isConnected: true` with a status other than `connected`.
- `getHydratedSnapshot(store, config, options)` takes the resolved config (`platforms` and `autoReconnect`) in place of the platforms array.
