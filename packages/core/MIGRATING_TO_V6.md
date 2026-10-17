# Migrating to Kheopskit v6

v6 tightens the wallet connection contract. `connect()` and `disconnect()` are
safe to call from UI code, rejections are typed, and no emission of the state
stream shows a disconnected wallet still listing accounts. Until a fix tracked
for 6.0.0 lands, an Ethereum wallet that reconnects while another connected
Ethereum wallet's `eth_accounts` request is pending may show the accounts of
its previous connection for as long as that request goes unanswered, and
`connect()` may resolve on that emission.

`@kheopskit/core`, `@kheopskit/react` and the repo release tag move to
**`6.0.0`** together.

This guide grows with each v6 change. Each section covers one area.

---

## At a glance

| Area | v5 | v6 |
|------|----|----|
| `connect()` twice in a row | the second call asks the extension again | both calls share one platform attempt; the extension is asked once and each call gets its own promise |
| `connect()` on a connected wallet | rejects `WALLET_ALREADY_CONNECTED` | resolves at once |
| `disconnect()` on a disconnected wallet | rejects `WALLET_NOT_CONNECTED` | resolves at once |
| Cancel a pending `connect()` | not possible | `connect({ signal })` rejects that caller `ABORTED` until the platform answers |
| `disconnect()` while a `connect()` pends | rejects `WALLET_NOT_CONNECTED` | aborts the connect and resolves |
| Refused prompt | the extension's plain `Error` | `KheopskitError` `USER_REJECTED` with `cause` |
| Other connect failure | platform error passed through | `KheopskitError` `CONNECT_FAILED` with `cause` |
| When `connect()` resolves | when the platform call returned | after `kheopskit$` emitted the wallet with `isConnected: true`; accounts a platform lists asynchronously (Ethereum `eth_accounts`) may follow in a later emission |
| Intermediate emissions | a wallet could show connected with the previous connection's accounts for one frame | a synchronous burst is one emission; no emission shows a disconnected wallet still listing accounts. Until a fix tracked for 6.0.0 lands, an Ethereum wallet that reconnects while another connected Ethereum wallet's `eth_accounts` request is pending may show the accounts of its previous connection for as long as that request goes unanswered, and `connect()` may resolve on that emission. |

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

- `ABORTED`: this `connect()` or `disconnect()` call was abandoned. For
  `connect()`, its `signal` fired before the platform answered, `disconnect()`
  was called while it pended, or the last `kheopskit$` subscriber
  unsubscribed. For either call, the wallet object came from a subscription
  that had already ended; the call then rejects without asking the platform
  and without changing the remembered list.
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

- **One platform attempt per wallet.** Concurrent `connect()` calls share it
  and the platform is asked once. Each call still gets its own promise: an
  abort through a caller's `signal` before the platform answers rejects that
  caller only, and an abort after the grant changes nothing. The attempt is
  abandoned once every caller that passed a signal has aborted and no caller
  without one joined, on `disconnect()`, or when the last `kheopskit$`
  subscriber unsubscribes; those reject every remaining caller `ABORTED`.
- **Resolution follows the state.** `connect()` resolves only after
  `kheopskit$` has emitted a state in which the wallet has
  `isConnected: true`; `disconnect()` after one with `isConnected: false`, or
  once a later `connect()` or the end of the subscription makes that emission
  impossible. The state your UI reads already reflects the change when the
  promise settles. This is about `isConnected`, not the account list: an
  authorised wallet may share zero accounts, and on platforms that list
  accounts asynchronously (Ethereum `eth_accounts`) the accounts may arrive in
  a later emission. What holds for every emission is that none shows a
  disconnected wallet still listing accounts. Until a fix tracked for 6.0.0
  lands, an Ethereum wallet that reconnects while another connected Ethereum
  wallet's `eth_accounts` request is pending may show the accounts of its
  previous connection for as long as that request goes unanswered, and
  `connect()` may resolve on that emission.
- **No default timeout.** A Polkadot extension prompt pends until the user
  answers it. Pass `AbortSignal.timeout(ms)` to cap your wait for the platform's
  answer. The wait for the state after a grant is not capped. Aborting ends
  your wait; it cannot close the extension's own prompt. Once no caller waits
  any more, a handle the extension returns afterwards is released, and the
  wallet is neither connected nor remembered.
- **A wallet that disappears.** A pending `connect()` rejects `ABORTED` when
  its wallet leaves the list (an extension removed, a Wallet Standard wallet
  unregistered); a pending `disconnect()` resolves, since the wallet is no
  longer connected.
- **`disconnect()` during a pending `connect()`** aborts the connect (its
  promise rejects `ABORTED`) and resolves. It never waits for the prompt. The
  same holds when the connect has been granted by the platform and is still
  waiting for `kheopskit$` to show it. In the other direction, `connect()`
  resolves a `disconnect()` still waiting for the state, since that disconnect
  did complete.
- **`disconnect()` forgets first.** The wallet leaves the remembered list
  before the extension is asked, so a disconnect still pending when the page
  unloads does not reconnect on the next load. If the extension refuses, the
  wallet is remembered again and stays connected. A `connect()` queued behind
  a pending `disconnect()` rejects `ABORTED` as soon as its `signal` fires or
  the last `kheopskit$` subscriber unsubscribes, even if the extension never
  answers.
- **Persistence is best-effort.** A storage write that throws
  (`QuotaExceededError`, a denied write) keeps the in-memory state while the
  store is observed (an unobserved store re-reads storage), and neither
  `connect()` nor `disconnect()` rejects because of it.
- **Wallet objects are stable.** An emission that only changes accounts keeps
  the same wallet object, with the same `connect` and `disconnect` functions,
  so effects and memos keyed on them do not re-run.
- **WalletConnect is unchanged.** The connector's `connect()` opens the modal
  and resolves once it is open; `isConnected` follows when the user approves.
- **No throttle on the stream.** `throttleTime(16)` is replaced by a microtask
  coalesce: a synchronous burst (wallets, then accounts) becomes one emission,
  so no emission shows a disconnected wallet still listing accounts. Until a
  fix tracked for 6.0.0 lands, an Ethereum wallet that reconnects while another
  connected Ethereum wallet's `eth_accounts` request is pending may show the
  accounts of its previous connection for as long as that request goes
  unanswered, and `connect()` may resolve on that emission. A wallet's
  accounts leave the state in the same emission that shows it disconnected,
  even while another wallet's accounts are being re-read. Accounts a platform
  lists asynchronously (Ethereum `eth_accounts`) may arrive in a later
  emission. The first emission can arrive one microtask after subscribe.
  `KheopskitProvider` still paints the cached snapshot synchronously.

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
  `signal` and abort it. When a caller without a signal shares the attempt
  (auto-reconnect does), a late approval still connects the wallet, so call
  `disconnect()` if the user must end up disconnected.

---

## 2. Store

### Renames

| v5 | v6 |
|----|----|
| `KheopskitStoreData.autoReconnect` | `KheopskitStoreData.remembered` |
| `store.addEnabledWalletId(walletId)` | `store.rememberWallet(walletId)` |
| `store.removeEnabledWalletId(walletId)` | `store.forgetWallet(walletId)` |

The list holds the wallets the user connected. Kheopskit adds a wallet on every
successful connect, whatever `config.autoReconnect` says, and removes it on
disconnect. The `autoReconnect` config option keeps its name and meaning: it
decides whether the remembered wallets reconnect on load.

The compact cookie format is unchanged. The list stays under the key `r`.

### Existing data migrates on read

Data written by v5 under `autoReconnect` is read as `remembered`, from
`localStorage`, from cookies (compact or legacy verbose JSON) and from changes
made by other tabs. The old key disappears on the next write. Users keep their
remembered wallets, and test fixtures that seed
`{ autoReconnect: [...] }` keep working.

### New: `storage` option and `destroy()`

`createKheopskitStore({ storage })` persists into any `SyncableStorage` (now
exported from `@kheopskit/core`). It takes precedence over `ssrCookies` and
`localStorage`.

The store holds its cross-tab subscription only while `store.observable` is
observed. Explicit owners call `store.destroy()`, which completes
`store.observable` and so ends that subscription.

### Account order inside a wallet

Accounts are still grouped by platform (Polkadot, Ethereum, Solana), then by
wallet (Talisman first, then by wallet name). Inside a wallet they now keep the
order the extension reported, instead of being sorted by name, address or id.

### Account renames

Renaming an account in the extension now emits a new state and updates the
cached account name. In v5 the rename was ignored until the account list
changed for another reason.

### What downstream apps delete

- signet: the `remembered$` read of `store.observable.autoReconnect` and the
  `store.removeEnabledWalletId` call in the extension domain. If the code stays
  for now, rename them to `remembered` and `forgetWallet`. Test seeds of
  `{ autoReconnect: [...] }` keep working through the migration.
- talisman-web: the `walletOrder` re-sort, which restored the extension's
  account order inside a wallet. The `injectionOrder` re-sort orders wallets by
  injection order; kheopskit still orders wallets Talisman first, then by name.
  Delete it if that order is acceptable.

## 3. Wallet status and reconnect

### New fields

| Field | Type | Meaning |
|-------|------|---------|
| `wallet.status` | `"disconnected" \| "connecting" \| "connected"` | `connecting` while a `connect()` call or an auto-reconnect waits for the platform. On the WalletConnect connector, while `connect()` opens the modal. |
| `wallet.error` | `KheopskitError \| undefined` | The last `connect()` or auto-reconnect that the platform refused (`USER_REJECTED`) or failed (`CONNECT_FAILED`). Cleared when the next attempt starts. An aborted attempt sets nothing. |
| `wallet.isConnected` | `boolean` | Unchanged, now defined as `status === "connected"`. No emission shows `isConnected: true` with another status. |

Test code that builds wallet objects by hand needs `status`.

### `autoReconnect` takes a function

```ts
autoReconnect: boolean | ((wallet: BaseWallet) => boolean)
```

The option governs injected wallets. The function is called per remembered
injected wallet, with its cached placeholder on the first frame and with its
live object before each attempt. It must be
synchronous and pure: the server and the client evaluate it for the same input
and both must agree, or the markup diverges. It receives the `BaseWallet`
fields only, so key on `wallet.id`.

Every successful `connect()` is still recorded in the remembered list, whatever
`autoReconnect` says.

### Refused reconnects are forgotten

A reconnect never prompts while the site stays authorised in the extension.
When the authorisation was revoked the extension prompts once; a refusal
forgets the wallet (it leaves the remembered list), so the next load stays
silent. Any other failure sets `wallet.error`, keeps the wallet remembered and
is retried up to three times when discovery changes. A manual `connect()` or
`disconnect()` on a remembered wallet ends its automatic reconnect for the
session, so a disconnect the user makes is never undone. Nothing is written to
`console.error` any more; `debug: true` logs the failure with `console.debug`.

### First frame after a reload

A cached connected wallet hydrates as `status: "connecting"`, `isConnected:
false`, with its cached accounts as placeholders, and stays so until its
reconnect settles. A wallet the predicate rejects hydrates as `disconnected`
without its cached accounts. With `autoReconnect: false` every cached injected
wallet hydrates as `disconnected`. The WalletConnect row follows AppKit's own
session restore, whatever `autoReconnect` says, and hydrates `connecting` while
AppKit restores. Nothing flashes from connected to disconnected.

### `getHydratedSnapshot` signature

```ts
// v5
getHydratedSnapshot(store, config.platforms, options)
// v6
getHydratedSnapshot(store, config, options)
```

The second argument is the resolved config (`platforms` and `autoReconnect`),
so the snapshot applies the same reconnect rule as the live stream.
`KheopskitProvider` passes it to both its server and client snapshots.

### What downstream apps delete

- A hand-rolled status map (`intents`, `statusOf`) keyed by wallet id. Read
  `wallet.status` and `wallet.error`.
- A reconnect loop over the remembered list (`reconnectRemembered$`) and its
  forget-on-refusal branch. Set `autoReconnect: true`.
- A "reconnect only this wallet" rule implemented by reading storage before
  calling `connect()`. Pass it as the `autoReconnect` function.

---

## 5. Placeholders carry `isPlaceholder`

### The union

Every wallet and account in `kheopskit$` and in the hydrated snapshot carries
`isPlaceholder`. It is `true` for an item restored from the cache that its live
counterpart has not replaced yet, and `false` otherwise. Each platform type is a
union on it:

| Type | Absent on a placeholder |
|------|-------------------------|
| `PolkadotAccount` | `txCreator` (polkadot-api v3) or `polkadotSigner` (v2) |
| `EthereumAccount` | `client` |
| `SolanaAccount` | `signer`, `getSigner` |
| `PolkadotInjectedWallet` | `extension`, `sourceId` |
| `EthereumInjectedWallet` | `provider`, `sourceId` |
| `SolanaInjectedWallet` | `wallet`, `chains`, `sourceId` |

In v5 these fields were typed as present and were `undefined` at runtime until
hydration ended. In v6 reading one without narrowing is a compile error:

```ts
// v5: compiles, throws while hydrating
await account.txCreator.signBytes(bytes);
// v6
if (account.isPlaceholder) return;
await account.txCreator.signBytes(bytes);
```

A placeholder wallet is never connected (`isConnected: false`). A cached wallet
that kheopskit has already discovered is not a placeholder: it carries its live
handle and shows `status: "connecting"` while its reconnect is pending. Its
cached accounts stay placeholders until the live accounts replace them.

Plugins never set the flag: kheopskit sets it on every item it emits, so a
custom plugin's wallet and account types type it as `isPlaceholder?: false`.

### `connect()` on a placeholder

| | v5 | v6 |
|---|----|----|
| `connect()` | throws `PendingWalletError` synchronously | waits for the live wallet with the same id and calls its `connect(options)`; rejects `WALLET_PENDING` if hydration ends without it, `ABORTED` if `signal` fires first |
| `disconnect()` | throws `PendingWalletError` synchronously | resolves at once |

`PendingWalletError` is gone. On a bare `getHydratedSnapshot()` result, which
has no live stream behind it, `connect()` rejects `WALLET_PENDING`.

### What downstream apps delete

- Guards that read an SDK field behind `!isHydrating` and cast it to present.
  Narrow on `isPlaceholder` instead; `isHydrating` can still disable the
  button.
- A `hasAccountsFrom`-style check that counts cached accounts as usable.
  Filter on `!account.isPlaceholder`.
- `try`/`catch` around a placeholder's `connect()` for `PendingWalletError`.
