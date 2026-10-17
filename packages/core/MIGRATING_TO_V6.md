# Migrating to Kheopskit v6

v6 tightens the wallet connection contract. `connect()` and `disconnect()` are
safe to call from UI code, rejections are typed, and no emission of the state
stream shows a disconnected wallet still listing accounts. Until a fix tracked
for 6.0.0 lands, an Ethereum wallet that reconnects while another connected
Ethereum wallet's `eth_accounts` request is pending may show the accounts of
its previous connection for as long as that request goes unanswered, and
`connect()` may resolve on that emission. v6 also renames the store's
remembered list, keeps the extension's account order, and changes how the
Polkadot plugin talks to an extension: kheopskit calls `enable()` itself, keeps
the raw object the extension returns, and exposes raw signing on every account.

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
| When `connect()` resolves | when the platform call returned | after `kheopskit$` emitted the wallet with `isConnected: true`; accounts a platform lists asynchronously (Ethereum `eth_accounts`, Polkadot `accounts.get()`) may follow in a later emission |
| Intermediate emissions | a wallet could show connected with the previous connection's accounts for one frame | a synchronous burst is one emission; no emission shows a disconnected wallet still listing accounts. Until a fix tracked for 6.0.0 lands, an Ethereum wallet that reconnects while another connected Ethereum wallet's `eth_accounts` request is pending may show the accounts of its previous connection for as long as that request goes unanswered, and `connect()` may resolve on that emission. |
| `wallet.extension` on a Polkadot wallet | pjs-signer's `InjectedExtension` (`getAccounts`, `subscribe`, `disconnect`) | the raw `enable()` result, typed `PolkadotInjected` (`accounts`, `signer`) |
| Raw signing | `txCreator.signBytes(bytes)` only, hex with `type: "bytes"` | plus `account.signRaw(data, { type? })`, text or bytes |
| `ethereum` accounts | signer built with type `ethereum`, 64-byte mock signature | signer built with `ecdsa`, 65-byte mock signature |
| Extension account subscription | kept after disconnect | released on disconnect and on teardown |
| `readonly`, `partOfPortfolio` (Talisman, its own origins) | present at runtime, not typed | typed on `PolkadotAccount` |

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
  accounts asynchronously (Ethereum `eth_accounts`, Polkadot `accounts.get()`) the accounts may arrive in
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
- **A wallet that disappears.** A `connect()` whose wallet leaves the list (an
  extension removed, a Wallet Standard wallet unregistered) before the platform
  grants it rejects `ABORTED`. Granted first, it resolves and the wallet stays
  remembered. A pending `disconnect()` resolves, since the wallet is no longer
  connected.
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
  lists asynchronously (Ethereum `eth_accounts`, Polkadot `accounts.get()`) may arrive in a later
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

---

## 3. Polkadot: raw signing and the injected handle

### `extension` is the raw `enable()` result

`PolkadotInjectedWallet.extension` is no longer pjs-signer's
`InjectedExtension`. It is the object `window.injectedWeb3[id].enable(appName)`
resolved to, typed structurally as `PolkadotInjected`:

```ts
type PolkadotInjected = {
  accounts: {
    get(): Promise<PolkadotInjectedAccount[]>;
    subscribe(cb: (accounts: PolkadotInjectedAccount[]) => void): () => void;
  };
  signer: { signPayload: SignPayload; signRaw(payload): Promise<{ id; signature }> };
  metadata?: unknown;
  provider?: unknown;
};
```

`getAccounts()`, `subscribe()` and `disconnect()` are gone from it. Read
accounts from `state.accounts`; kheopskit owns the subscription. The field is
`undefined` while the wallet is disconnected and while `state.isHydrating` is
`true`.

```diff
- const accounts = wallet.extension?.getAccounts() ?? [];
+ const accounts = state.accounts.filter((a) => a.walletId === wallet.id);
```

### `account.signRaw`

Every Polkadot account has
`signRaw(data: string | Uint8Array, options?: { type?: "bytes" | "payload" })`.
It resolves the hex signature. A string is sent as text and a `Uint8Array` as
`0x` hex. Injected accounts go through the extension's `signer.signRaw`,
WalletConnect accounts through `polkadot_signMessage`.

With no `options.type`, a string is sent as text with `type: "payload"` and a
`Uint8Array` as `0x` hex with `type: "bytes"`. An explicit `options.type` is
sent as given for either input. A hex-looking string is sent as text; pass a
`Uint8Array` for bytes. From their sources: Talisman, polkadot.js, SubWallet
and Nova ignore `type` and decode `data` by shape; Enkrypt reads it as the
encoding of `data`, `"payload"` for UTF-8 text and `"bytes"` for hex, so it
needs the value the derived default sends. Only Talisman was driven live.

Talisman 3.11.0 opens its Sign In screen when the text parses as a SIWS
message and its generic Sign Request screen otherwise, hex included. The
screen follows the text `data`, not `type`: live receipts with the same text
and both values show the same screen. The SIWS `Version` line must read `1.0.0`;
Talisman's parser rejects `1` and falls back to the generic screen.

```ts
const signature = await account.signRaw(siwsMessage);
```

`txCreator.signBytes` is unchanged.

### `ethereum` accounts sign as `ecdsa`

For an account whose `type` is `"ethereum"`, kheopskit builds the `txCreator`
(or `polkadotSigner` on polkadot-api v2) with the `ecdsa` signature type.
pjs-signer's own map knows `ed25519`, `sr25519` and `ecdsa` only, so an
`ethereum` type got a 64-byte mock signature where ecdsa needs 65. Fee
estimation and dry runs for ethereum-format accounts no longer use the wrong
length.

### The account subscription is released

v5 subscribed to the extension's account list and never unsubscribed. v6
unsubscribes when the wallet disconnects and when the last `kheopskit$`
subscriber leaves.

### Untyped accounts are kept

Accounts the extension lists without a `type` are now kept as `sr25519`. v5
went through pjs-signer, which dropped them. `polkadot({ accountTypes })` is
the only filter.

### `connect()` rejects an incomplete extension

`connect()` rejects with `CONNECT_FAILED`, and the wallet stays disconnected
and unremembered, when the `enable()` result lacks `accounts.get`,
`accounts.subscribe`, `signer.signPayload` or `signer.signRaw`. `cause` holds
an `Error` whose message names the extension, for example
`Unsupported extension: "talisman"`. An account kheopskit cannot build is
skipped and the wallet's other accounts are listed.

### `readonly` and `partOfPortfolio`

Talisman adds these two fields to the accounts it shares with its own dapp
origins: `readonly` marks a watch-only account that cannot sign, and
`partOfPortfolio` a watch-only account that is part of the user's portfolio.
They are typed on `PolkadotInjectedAccount` and `PolkadotAccount` as optional
booleans and are absent for other origins and other wallets.

### polkadot-api v2

v2 still works. The account carries `polkadotSigner` instead of `txCreator`,
and the fourth factory argument (the signature type) is ignored by
`getPolkadotSignerFromPjs` at runtime.

### What to delete in your app

- A second `enable()` call made to reach `signer.signRaw` for a Sign-In With
  Substrate message. Call `account.signRaw(message)`.
- A hand-built `ecdsaTxCreator` for ethereum-format accounts, and a
  `signatureTypeOf` helper that maps `ethereum` to `ecdsa`.
- A memoised second `enable()` and a `pjsSignerOf` helper that rebuilds a pjs
  signer from the raw extension. Use `account.txCreator`.
- A `TalismanInjectedAccount` cast that adds `readonly` and `partOfPortfolio`.
  They are on `PolkadotAccount`.
