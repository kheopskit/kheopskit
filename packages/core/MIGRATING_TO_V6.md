# Migrating to Kheopskit v6

v6 tightens the wallet connection contract. `connect()` and `disconnect()` are
safe to call from UI code, rejections are typed, and the state stream never
shows a wallet as connected while its accounts are stale.

`@kheopskit/core`, `@kheopskit/react` and the repo release tag move to
**`6.0.0`** together.

This guide grows with each v6 change. Each section covers one area.

---

## At a glance

| Area | v5 | v6 |
|------|----|----|
| `connect()` twice in a row | the second call asks the extension again | both calls share one pending promise; the extension is asked once |
| `connect()` on a connected wallet | rejects `WALLET_ALREADY_CONNECTED` | resolves at once |
| `disconnect()` on a disconnected wallet | rejects `WALLET_NOT_CONNECTED` | resolves at once |
| Cancel a pending `connect()` | not possible | `connect({ signal })` rejects `ABORTED` |
| `disconnect()` while a `connect()` pends | rejects `WALLET_NOT_CONNECTED` | aborts the connect and resolves |
| Refused prompt | the extension's plain `Error` | `KheopskitError` `USER_REJECTED` with `cause` |
| Other connect failure | platform error passed through | `KheopskitError` `CONNECT_FAILED` with `cause` |
| When `connect()` resolves | when the platform call returned | after `kheopskit$` emitted the wallet with `isConnected: true` |
| Intermediate emissions | a wallet could show connected with stale accounts for one frame | a synchronous burst is one emission |

---

## 1. Connect and disconnect

### Removed codes

`WALLET_ALREADY_CONNECTED` and `WALLET_NOT_CONNECTED` leave
`KheopskitErrorCode`. A repeat call is a no-op that resolves.

```diff
- try {
-   await wallet.connect();
- } catch (error) {
-   if (error instanceof KheopskitError && error.code === "WALLET_ALREADY_CONNECTED") return;
-   throw error;
- }
+ await wallet.connect();
```

### New codes

- `ABORTED`: the pending `connect()` was abandoned. Its `signal` fired,
  `disconnect()` was called while it pended, or the last `kheopskit$`
  subscriber unsubscribed.
- `USER_REJECTED`: the user refused the wallet prompt. `cause` holds the
  platform error: an EIP-1193 error with `code: 4001` on Ethereum; on
  Polkadot the extension's own `Error`, for Talisman
  `Site <url> has not been authorised for Talisman yet` (observed live for
  both the Reject button and a closed prompt), for polkadot-js
  `Connection request was rejected by the user.` or `... cancelled by the
  user.`, for SubWallet `Rejected` or `Cancelled`.
- `CONNECT_FAILED`: any other platform failure. `cause` holds the platform
  error.

Every rejection is a `KheopskitError` carrying `walletId`.

```ts
try {
  await wallet.connect({ signal: AbortSignal.timeout(60_000) });
} catch (error) {
  if (!(error instanceof KheopskitError)) throw error;
  switch (error.code) {
    case "USER_REJECTED":
    case "ABORTED":
      return;
    case "CONNECT_FAILED":
      report(error.cause);
      return;
  }
}
```

### New semantics

- **One pending promise per wallet.** Concurrent `connect()` calls share it
  and the platform is asked once. An abort through any sharer's `signal`
  rejects every sharer.
- **Resolution follows the state.** `connect()` resolves only after
  `kheopskit$` has emitted a state in which the wallet has
  `isConnected: true`; `disconnect()` after one with `isConnected: false`.
  The state your UI reads already reflects the change when the promise
  settles. An authorised wallet may share zero accounts, so this is about
  `isConnected`, not the account list.
- **No default timeout.** A Polkadot extension prompt pends until the user
  answers it. Pass `AbortSignal.timeout(ms)` to cap the wait. Aborting ends
  your wait; it cannot close the extension's own prompt. A handle the
  extension returns afterwards is released, and the wallet is neither
  connected nor remembered.
- **`disconnect()` during a pending `connect()`** aborts the connect (its
  promise rejects `ABORTED`) and resolves. It never waits for the prompt.
- **WalletConnect is unchanged.** The connector's `connect()` opens the modal
  and resolves once it is open; `isConnected` follows when the user approves.
- **No throttle on the stream.** `throttleTime(16)` is replaced by a microtask
  coalesce: a synchronous burst (wallets, then accounts) becomes one emission,
  so no emission shows a wallet connected with stale accounts. The first
  emission can arrive one microtask after subscribe. `KheopskitProvider` still
  paints the cached snapshot synchronously.

### What to delete in your app

- Dedup wrappers around `connect()`, such as a `requestOnce` or `connectOnce`
  map keyed by wallet id.
- `auditTime(20)` or `debounceTime(20)` placed after `kheopskit$` to skip the
  stale intermediate state.
- Treating `WALLET_ALREADY_CONNECTED` as success and swallowing
  `WALLET_NOT_CONNECTED`.
- Refusal detection by `error.name === "Error"` or by message text. Branch on
  `error.code === "USER_REJECTED"`.
- Cancel flows that forget the wallet and disconnect a late approval. Pass a
  `signal` and abort it.
