# Migrating to Kheopskit v6

v6 tightens the wallet connection contract. `connect()` and `disconnect()` are
safe to call from UI code, `connect()` rejections are typed, and no emission of
the state stream shows a disconnected wallet still listing live accounts or a
connected wallet listing the accounts of a previous connection. v6 also renames
the store's remembered list, keeps the extension's account order, and changes
how the Polkadot plugin talks to an extension. Kheopskit calls `enable()`
itself, keeps the raw object the extension returns, and exposes raw signing on
every live account.

`@kheopskit/core`, `@kheopskit/react` and the repo release tag move to
**`6.0.0`** together.

This guide grows with each v6 change. Each section covers one area.

---

## At a glance

| Area | v5 | v6 | See |
|------|----|----|-----|
| `connect()` twice in a row | the second call asks the extension again | both calls share one platform attempt; the extension is asked once and each call gets its own promise | [1](#1-connect-and-disconnect) |
| `connect()` on a connected wallet | rejects `WALLET_ALREADY_CONNECTED` | resolves at once | [1](#1-connect-and-disconnect) |
| `disconnect()` on a disconnected wallet | rejects `WALLET_NOT_CONNECTED` | resolves at once | [1](#1-connect-and-disconnect) |
| Cancel a pending `connect()` | not possible | `connect({ signal })` rejects that caller `ABORTED` until the platform answers | [1](#1-connect-and-disconnect) |
| `disconnect()` while a `connect()` pends | rejects `WALLET_NOT_CONNECTED` | aborts the connect and resolves | [1](#1-connect-and-disconnect) |
| Refused prompt | the extension's plain `Error` | `KheopskitError` `USER_REJECTED` with `cause` | [1](#1-connect-and-disconnect) |
| Other connect failure | platform error passed through | `KheopskitError` `CONNECT_FAILED` with `cause` | [1](#1-connect-and-disconnect) |
| When `connect()` resolves | when the platform call returned | after `kheopskit$` emitted the wallet with `isConnected: true`, with two exceptions; accounts a platform lists asynchronously (Ethereum `eth_accounts`) may follow in a later emission | [1](#1-connect-and-disconnect) |
| Intermediate emissions | a wallet could show connected with the previous connection's accounts for one frame | a synchronous burst is one emission; no emission shows a disconnected wallet still listing live accounts or a connected wallet listing a previous connection's accounts; cached placeholder accounts stay listed during hydration | [1](#1-connect-and-disconnect) |
| Account streams | one read per platform, re-run for every wallet of the platform whenever any wallet changes | in `kheopskit$`, one stream per wallet connection, started empty; a sibling's connect or disconnect leaves it alone and its pending request delays nobody | [1](#1-connect-and-disconnect) |
| Store's remembered list | `KheopskitStoreData.autoReconnect` | `KheopskitStoreData.remembered`; v5 data migrates on read | [2](#2-store) |
| Edit the remembered list | `store.addEnabledWalletId`, `store.removeEnabledWalletId` | `store.rememberWallet`, `store.forgetWallet` | [2](#2-store) |
| Custom storage | not possible | `createKheopskitStore({ storage })` | [2](#2-store) |
| Release a store | not possible | `store.destroy()` | [2](#2-store) |
| Account order inside a wallet | sorted by name, address or id | the order the extension lists them in | [2](#2-store) |
| `wallet.extension` on a Polkadot wallet | pjs-signer's `InjectedExtension` (`getAccounts`, `subscribe`, `disconnect`) | the raw `enable()` result, typed `PolkadotInjected` (`accounts`, `signer`) | [3](#3-polkadot-raw-signing-and-the-injected-handle) |
| Raw signing | `txCreator.signBytes(bytes)` only, hex with `type: "bytes"` | plus `account.signRaw(data, { type? })`, text or bytes | [3](#3-polkadot-raw-signing-and-the-injected-handle) |
| `ethereum` accounts | signer built with type `ethereum`, 64-byte mock signature | on polkadot-api v3, signer built with `ecdsa`, 65-byte mock signature | [3](#3-polkadot-raw-signing-and-the-injected-handle) |
| Extension account subscription | kept after disconnect | released on disconnect and on teardown | [3](#3-polkadot-raw-signing-and-the-injected-handle) |
| `readonly`, `partOfPortfolio` (Talisman, its own origins) | present at runtime, not typed | typed on `PolkadotAccount` | [3](#3-polkadot-raw-signing-and-the-injected-handle) |
| Wallet status | `isConnected` only | `status` (`disconnected`, `connecting`, `connected`) and `error` | [4](#4-wallet-status-and-reconnect) |
| `autoReconnect` | `boolean` | `boolean` or a pure function of the wallet | [4](#4-wallet-status-and-reconnect) |
| Refused reconnect | logged with `console.error`; the wallet stayed remembered | forgets the wallet | [4](#4-wallet-status-and-reconnect) |
| `getHydratedSnapshot` | `(store, platforms, options)` | `(store, config, options)`; `config` carries `autoReconnect` | [4](#4-wallet-status-and-reconnect) |
| `config.walletConnect` | raw options object | `walletConnect(options)` from `@kheopskit/core/walletconnect`; a raw object throws `INVALID_CONFIG` | [5](#5-walletconnect-is-a-plugin) |
| Test kit | none; apps fake `injectedWeb3` themselves | `@kheopskit/core/testing` | [6](#6-test-kit) |
| Placeholder SDK handles | typed as present, `undefined` at runtime while hydrating | absent from the placeholder type; narrow on `isPlaceholder` | [7](#7-placeholders-carry-isplaceholder) |
| `connect()` on a placeholder | throws `PendingWalletError` | waits for the live wallet, or rejects `WALLET_PENDING` | [7](#7-placeholders-carry-isplaceholder) |
| Hydration end | `isHydrating` stays `true` until every cached connected wallet reconnected, capped at six times the grace period | `isHydrating` ends once the grace period has elapsed and every cached wallet has settled, or at `hydrationTimeout` (default 3000 ms); a cached wallet not yet discovered settles when discovery ends | [8](#8-discovery-hydration-end-and-persistence) |
| Discovery at page load | the Polkadot registry was read at 0, 100, 300, 600 and 1100 ms after subscribe only | read at subscribe and at `load`, then 100, 300, 600 and 1100 ms after each; `state.isDiscovering` is `true` until the last read, 1100 ms after `load` or after subscribe, whichever is later, and while a WalletConnect connector loads | [8](#8-discovery-hydration-end-and-persistence) |
| Cache during a slow reconnect | a reconnect slower than the persistence debounce wrote `isConnected: false` and no accounts | a wallet still `connecting` keeps its previous cached entry and accounts | [8](#8-discovery-hydration-end-and-persistence) |
| React instance and hooks | `createKheopskit` returns a provider and `useWallets`/`useAccounts`; reaching one wallet means reading the whole state; unmounting the provider leaves the pipeline running | `createKheopskit` also returns `kheopskit$` and `store`; `useWallet`, `useAccount` and `useConnect` read one item; unmounting the provider stops the pipeline | [9](#9-kheopskitreact-one-shared-instance-and-wallet-hooks) |

---

## What you can delete

Each section ends with the app code it makes redundant. In short:

- A gate that delays subscribing until `load`, and a fixed grace after it
  before concluding that a wallet is missing. Both are redundant, because the
  read window now runs until 1100 ms after `load` or after subscribe,
  whichever is later. Wait for `isDiscovering` to turn `false` (section 8).
- Connect dedup wrappers, such as a `requestOnce` or `connectOnce` map keyed by
  wallet id (section 1). An app that calls `connect()` in reaction to state
  must then skip a wallet whose `error.code` is `USER_REJECTED`.
- `auditTime(20)` or `debounceTime(20)` placed after `kheopskit$` to skip the
  stale intermediate state (section 1).
- Refusal detection by `error.name === "Error"` or by message text. Branch on
  `error.code === "USER_REJECTED"` (section 1).
- A hand-rolled status map and reconnect loop over the remembered list. Read
  `wallet.status` and `wallet.error`, and set `autoReconnect` (section 4).
- A second `enable()` call made to reach `signer.signRaw`. Call
  `account.signRaw(message)` (section 3).
- A hand-built `ecdsa` tx creator for ethereum-format accounts (section 3).
- A second `getKheopskit$` subscription next to the React provider. Subscribe
  to the `kheopskit$` that `createKheopskit` returns (section 9).
- Test seeds that write the persisted shape to raw storage. Use
  `store.rememberWallet` and `store.setCachedState` with the test kit's
  builders (section 6).

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
  unsubscribed. For either call on an injected wallet, the wallet object came
  from a subscription that had already ended; the call then rejects without
  asking the platform and without changing the remembered list. A
  placeholder's `connect()` rejects the same way and its `disconnect()`
  resolves. The WalletConnect connector is not wrapped and still calls AppKit.
- `USER_REJECTED`: the user refused the wallet prompt. `cause` holds the
  platform error. It is an EIP-1193 error with `code: 4001` on Ethereum; on
  Polkadot the extension's own `Error`, for Talisman
  `Site <url> has not been authorised for Talisman yet` (observed live for
  both the Reject button and a closed prompt), for polkadot-js
  `Connection request was rejected by the user.` or `... cancelled by the
  user.`, for SubWallet `Rejected` or `Cancelled`.
- `CONNECT_FAILED`: any other platform failure. `cause` holds the platform
  error.
- `INVALID_CONFIG`: `getKheopskit$` throws it synchronously when
  `config.walletConnect` is not a plugin created by `walletConnect()` from
  `@kheopskit/core/walletconnect` (see section 5). It is not a rejection and
  carries no `walletId`.

Every rejection of `connect()` is a `KheopskitError` carrying `walletId`, and
so is an `ABORTED` `disconnect()`. A `disconnect()` whose platform call fails
(Solana, the WalletConnect connector) rejects with the platform's own error.

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
  and the platform is asked once. Each call still gets its own promise. An
  abort through a caller's `signal` before the platform answers rejects that
  caller only, and an abort after the grant changes nothing. A Polkadot
  extension counts as granted only once its account list has been read. The
  attempt is abandoned once every caller that passed a signal has aborted and
  no caller without one joined, on `disconnect()`, or when the last `kheopskit$`
  subscriber unsubscribes; those reject every remaining caller `ABORTED`.
- **Resolution follows the state.** `connect()` resolves once `kheopskit$` has
  emitted a state in which the wallet has `isConnected: true`. An injected
  wallet's refused or failed `connect()` rejects after `kheopskit$` has
  emitted the wallet `disconnected` with that `error`. `disconnect()`
  first waits for the platform's disconnect, when the platform has one, then
  resolves once a state shows `isConnected: false`, or once a later
  `connect()`, the wallet leaving the list or the end of the subscription
  makes that emission impossible. A `disconnect()` still waiting for the
  platform settles only when the platform answers, whatever happens to the
  subscription. The state your UI reads already reflects the change when the
  promise settles, with two exceptions. A `connect()` whose wallet leaves the
  list after the grant resolves without such a state. One whose wallet a
  `disconnect()` takes down first rejects `ABORTED`. This is about
  `isConnected`, not the account list. An authorised wallet may share zero
  accounts, and on platforms that list accounts asynchronously (Ethereum
  `eth_accounts`) the accounts may arrive in a later emission. What holds for
  every emission is that none shows a disconnected wallet still listing live
  accounts or a connected wallet listing the accounts of a previous
  connection. During hydration a wallet's cached placeholder accounts stay
  listed whatever its status.
- **No default timeout.** A Polkadot extension prompt pends until the user
  answers it. Pass `AbortSignal.timeout(ms)` to cap your wait for the platform's
  answer. The wait for the state after a grant is not capped. Aborting ends
  your wait; it cannot close the extension's own prompt. A `connect()` started
  while that prompt is open, after an abort or a `disconnect()`, waits for the
  same prompt instead of asking the extension again, and connects with the
  handle it returns. Once no caller waits any more and no later `connect()`
  joined that prompt, kheopskit drops a handle the extension returns
  afterwards without revoking the extension's grant, and the wallet is
  neither connected nor remembered.
- **A wallet that disappears.** A `connect()` whose wallet leaves the list (an
  extension removed, a Wallet Standard wallet unregistered) before the platform
  grants it rejects `ABORTED`. Granted first, it resolves and the wallet stays
  remembered. A `disconnect()` waiting for the state resolves, since the wallet
  is no longer connected. One still waiting for the platform settles when the
  platform answers.
- **`disconnect()` during a pending `connect()`** that the platform has not
  granted aborts the connect (its promise rejects `ABORTED`) and resolves. It
  never waits for the prompt. A `disconnect()` that completes while a granted
  `connect()` still waits for `kheopskit$` to show it rejects that connect
  `ABORTED`. If the platform's disconnect is still pending or refuses, the
  connect resolves once the state shows the wallet connected (today only
  Solana has a platform disconnect). In the other direction, `connect()`
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
- **WalletConnect still resolves when the modal opens.** The connector's
  `connect()` opens the modal and resolves once it is open; `isConnected`
  follows when the user approves.
- **No throttle on the stream.** `throttleTime(16)` is replaced by a microtask
  coalesce. A synchronous burst (wallets, then accounts) becomes one emission,
  so no emission shows a disconnected wallet still listing live accounts. A
  wallet's live accounts leave the state in the same emission that shows it
  disconnected,
  even while another wallet's `eth_accounts` request is pending. Accounts a
  platform lists asynchronously (Ethereum `eth_accounts`) may arrive in a later
  emission. The first emission can arrive one microtask after subscribe.
  `KheopskitProvider` still paints the cached snapshot synchronously.
- **One account stream per wallet connection.** v5 read every wallet of a
  platform together and re-read them all whenever any wallet connected or
  disconnected, so one wallet's slow `eth_accounts` held back the others, a
  reconnecting wallet could show the accounts of its previous connection until
  a sibling answered, and `connect()` could resolve on that emission. v6 starts
  one stream per wallet when it connects, empty, and ends it when the wallet
  disconnects. No emission shows a connected wallet listing a previous
  connection's accounts, a sibling's pending request delays nobody, a sibling's
  connect or disconnect neither re-reads nor resubscribes a wallet's accounts,
  and a Polkadot extension's `accounts.subscribe` runs once per connection.
  One exception. The first value of a platform plugin's `getAccounts$`, called
  directly with wallets that are already connected, waits until each of them
  has answered. `kheopskit$` subscribes before any wallet is connected, so it
  never waits.

### What to delete in your app

- Dedup wrappers around `connect()`, such as a `requestOnce` or `connectOnce`
  map keyed by wallet id. Kheopskit shares only concurrent calls. A refused
  attempt has ended when its `USER_REJECTED` state is emitted, so a
  `connect()` made in reaction to that state asks the extension again. An app
  that connects from state skips a wallet whose `error.code` is
  `USER_REJECTED`. The map used to hide this, because its entry outlived the
  emission.
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

The list holds the injected wallets the user connected. Kheopskit adds a
wallet on every successful connect, whatever `config.autoReconnect` says, and
removes it when a connected wallet is disconnected. The WalletConnect
connector is never added; AppKit restores its own session. The `autoReconnect`
config option keeps its name and meaning. It decides whether the remembered
wallets reconnect on load.

The compact cookie format is unchanged. The list stays under the key `r`.

### Existing data migrates on read

Data written by v5 under `autoReconnect` is read as `remembered`, from
`localStorage`, from cookies (compact or legacy verbose JSON) and from changes
made by other tabs. The old key disappears on the next write. Users keep their
remembered wallets, and test fixtures that write `{ autoReconnect: [...] }`
into storage keep working. A literal typed as `KheopskitStoreData` must rename
the key to `remembered`, since `autoReconnect` is no longer a field of it.

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
  for now, rename them to `remembered` and `forgetWallet`. Test seeds that
  write `{ autoReconnect: [...] }` into storage keep working through the
  migration.
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
accounts from `state.accounts`; kheopskit owns the subscription. As in v5,
`connect()` reads `accounts.get()` before it resolves, so the emission that
first shows the wallet connected already lists its accounts; the list then
follows `accounts.subscribe`. The field is `undefined` until the wallet is
connected, so also while it connects, and a placeholder (section 7) has none.

```diff
- const accounts = wallet.extension?.getAccounts() ?? [];
+ const accounts = state.accounts.filter((a) => a.walletId === wallet.id);
```

### `account.signRaw`

Every Polkadot account that is not a placeholder (section 7) has
`signRaw(data: string | Uint8Array, options?: { type?: "bytes" | "payload" })`.
It resolves the hex signature. A string is sent as text and a `Uint8Array` as
`0x` hex. Injected accounts go through the extension's `signer.signRaw`,
WalletConnect accounts through `polkadot_signMessage`.

With no `options.type`, a string is sent as text with `type: "payload"` and a
`Uint8Array` as `0x` hex with `type: "bytes"`. An explicit `options.type` is
sent as given for either input, except over WalletConnect, which sends no
`type`. A hex-looking string is sent as text; pass a `Uint8Array` for bytes.
From their sources: Talisman, polkadot.js, SubWallet and Nova ignore `type`
and decode `data` by shape; Enkrypt reads it as the encoding of `data`,
`"payload"` for UTF-8 text and `"bytes"` for hex, so it needs the value the
derived default sends. Only Talisman was driven live.

Talisman 3.11.0 opens its Sign In screen when the text parses as a SIWS
message and its generic Sign Request screen otherwise, hex included. The
screen follows the text `data`, not `type`. Live receipts with the same text
and both values show the same screen. The SIWS `Version` line must read `1.0.0`;
Talisman's parser rejects `1` and falls back to the generic screen.

```ts
if (account.isPlaceholder) return;
const signature = await account.signRaw(siwsMessage);
```

On a live account, `txCreator.signBytes` still sends hex with
`type: "bytes"`. Reading `txCreator` needs the same `isPlaceholder` narrowing
([section 7](#7-placeholders-carry-isplaceholder)).

### `ethereum` accounts sign as `ecdsa`

For an account whose `type` is `"ethereum"`, kheopskit builds the `txCreator`
with the `ecdsa` signature type. On polkadot-api v2, `getPolkadotSignerFromPjs`
ignores the signature type, so this change does not reach `polkadotSigner`.
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
the only type filter.

### `connect()` rejects an incomplete extension

`connect()` rejects with `CONNECT_FAILED`, and the wallet stays disconnected
and unremembered, when the `enable()` result lacks `accounts.get`,
`accounts.subscribe`, `signer.signPayload` or `signer.signRaw`, or when
`accounts.get()` rejects. `cause` holds an `Error` whose message names the
extension, for example `Unsupported extension: "talisman"`, or the extension's
own error. An `accounts.get()` rejection whose message matches a known refusal
(section 1) maps to `USER_REJECTED` instead, and a reconnect that fails this
way forgets the wallet. An account kheopskit cannot build is skipped and the
wallet's other accounts are listed.

### `readonly` and `partOfPortfolio`

Talisman adds these two fields to the accounts it shares with its own dapp
origins: `readonly` marks a watch-only account that cannot sign, and
`partOfPortfolio` a watch-only account that is part of the user's portfolio.
They are typed on `PolkadotInjectedAccount` and `PolkadotAccount` as optional
booleans and are absent for other origins and other wallets.

### polkadot-api v2

v2 still works. Apart from the `isPlaceholder` narrowing of
[section 7](#7-placeholders-carry-isplaceholder), apps on it change nothing in
their signing code. An un-narrowed `account.polkadotSigner` is possibly
`undefined` and no longer compiles where a signer is required. The account
keeps carrying `polkadotSigner` instead of `txCreator`. The fourth
factory argument (the signature type) is ignored by `getPolkadotSignerFromPjs`
at runtime.

### What to delete in your app

- A second `enable()` call made to reach `signer.signRaw` for a Sign-In With
  Substrate message. Call `account.signRaw(message)`.
- A hand-built `ecdsaTxCreator` for ethereum-format accounts, and a
  `signatureTypeOf` helper that maps `ethereum` to `ecdsa`.
- A memoised second `enable()` and a `pjsSignerOf` helper that rebuilds a pjs
  signer from the raw extension. Use `account.txCreator`.
- A `TalismanInjectedAccount` cast that adds `readonly` and `partOfPortfolio`.
  They are on `PolkadotAccount`.

---

## 4. Wallet status and reconnect

### New fields

| Field | Type | Meaning |
|-------|------|---------|
| `wallet.status` | `"disconnected" \| "connecting" \| "connected"` | `connecting` while a `connect()` call or an auto-reconnect waits for the platform. On the WalletConnect connector, while `connect()` opens the modal. |
| `wallet.error` | `KheopskitError \| undefined` | The last `connect()` or auto-reconnect that the platform refused (`USER_REJECTED`) or failed (`CONNECT_FAILED`, or `FEATURE_NOT_SUPPORTED` for a Wallet Standard wallet without `standard:connect`). Cleared when the next attempt starts. An aborted attempt sets nothing. |
| `wallet.isConnected` | `boolean` | Unchanged, now defined as `status === "connected"`. No emission shows `isConnected: true` with another status. |

Test code that builds wallet objects by hand needs `status`.

### `autoReconnect` takes a function

```ts
autoReconnect: boolean | ((wallet: BaseWallet) => boolean)
```

The option governs injected wallets. The function is called for each cached
connected injected wallet on the first frame, then for each remembered wallet
with its live object before each attempt. It must be synchronous and pure. The
server and the client evaluate it for the same input and both must agree, or
the markup diverges. It receives the `BaseWallet` fields only, so key on
`wallet.id`.

Every successful `connect()` of an injected wallet is still recorded in the
remembered list, whatever `autoReconnect` says.

### Refused reconnects are forgotten

A reconnect opens no connect prompt while the site stays authorised in the
extension. When the authorisation was revoked the extension prompts once; a
refusal forgets the wallet (it leaves the remembered list), so the next load
stays silent. Any other failure sets `wallet.error`, keeps the wallet
remembered and is retried on the next change to the wallet list, 3 attempts in
total. A manual `connect()` or `disconnect()` on a remembered wallet ends its
automatic reconnect for the session. A `disconnect()` while the automatic
reconnect still waits for the extension aborts it without forgetting the
wallet, so the next load reconnects it. Automatic reconnect also ends when the
wallet disappears mid-attempt; the wallet stays remembered for the next load.
Nothing is written to `console.error` any more; `debug: true` logs the failure
with `console.debug`.

### First frame after a reload

A cached connected wallet hydrates as `status: "connecting"`, `isConnected:
false`, with its cached accounts as placeholders, and stays so until its
reconnect settles. A wallet the predicate rejects hydrates as `disconnected`
without its cached accounts. With `autoReconnect: false` every cached injected
wallet hydrates as `disconnected`. The WalletConnect row follows AppKit's own
session restore, whatever `autoReconnect` says, and hydrates `connecting` while
AppKit restores. Nothing flashes from connected to disconnected.

### `getHydratedSnapshot` signature

`getHydratedSnapshot`, a public export of `@kheopskit/core`, takes the config
instead of the platform list:

```diff
- getHydratedSnapshot(store, config.platforms, options)
+ getHydratedSnapshot(store, config, options)
```

The second argument is `Pick<KheopskitConfig, "platforms" | "autoReconnect">`,
so the snapshot applies the same `autoReconnect` boolean or predicate as the
live stream. A cached connected wallet the predicate rejects hydrates as
`disconnected` without its cached accounts.
`KheopskitProvider` passes it to both its server and client snapshots.

### What downstream apps delete

- A hand-rolled status map (`intents`, `statusOf`) keyed by wallet id. Read
  `wallet.status` and `wallet.error`.
- A reconnect loop over the remembered list (`reconnectRemembered$`) and its
  forget-on-refusal branch. Set `autoReconnect: true`.
- A "reconnect only this wallet" rule implemented by reading storage before
  calling `connect()`. Pass it as the `autoReconnect` function.

---

## 5. WalletConnect is a plugin

WalletConnect moved to its own entry point, `@kheopskit/core/walletconnect`.
`config.walletConnect` takes the plugin that entry's `walletConnect()` returns.
A dapp that does not import the entry bundles none of kheopskit's AppKit code
and none of the AppKit chunks.

```ts
// v5
import { getKheopskit$ } from "@kheopskit/core";

getKheopskit$({
  platforms: [polkadot()],
  walletConnect: { projectId, metadata, networks },
});

// v6
import { getKheopskit$ } from "@kheopskit/core";
import { walletConnect } from "@kheopskit/core/walletconnect";

getKheopskit$({
  platforms: [polkadot()],
  walletConnect: walletConnect({ projectId, metadata, networks }),
});
```

| v5 | v6 |
|----|----|
| `walletConnect: { projectId, metadata, networks, ... }` | `walletConnect: walletConnect({ projectId, metadata, networks, ... })`. A raw object is a type error, and `getKheopskit$` throws a `KheopskitError` with the new code `INVALID_CONFIG` |
| `import { resetAppKitCache } from "@kheopskit/core"` | `import { resetAppKitCache } from "@kheopskit/core/walletconnect"` |
| `WalletConnectConfig` from `@kheopskit/core` | `WalletConnectOptions` from `@kheopskit/core/walletconnect` |
| `relayUrl` option | removed. It was never passed to AppKit |

`WalletConnectWallet`, `isWalletConnectWallet`, `WalletConnectMetadata` and
`AppKitInstance` stay in `@kheopskit/core`. The Polkadot `appName` fallback
still reads the plugin's `metadata.name`.

Dapps that never set `walletConnect` need no change for this section. Their
bundle shrinks. A Polkadot-only Vite app built against 5.3.0 and against
6.0.0, with `@reown/appkit` installed (as it is when another dependency pulls it in):

| | 5.3.0 | 6.0.0 |
|---|---|---|
| JS chunks | 67 | 1 |
| JS total, gzip -9 | 465,575 B | 46,804 B |
| Entry chunk, gzip -9 | 47,739 B | 46,822 B |

Without `@reown/appkit` installed, 5.3.0 builds a stub chunk that throws
`Could not resolve "@reown/appkit/core"`; 6.0.0 builds none.

---

## 6. Test kit

v6 adds `@kheopskit/core/testing` (see the
[core README](README.md#testing)). It replaces the `injectedWeb3` fakes that
signet and talisman-web keep in `domains/extension/fakeInjectedWeb3.ts`.

| App helper | Kit |
|------------|-----|
| `fakeWallet(accounts)` in an `injectedWeb3` map passed to `vi.stubGlobal` | `createFakePolkadotExtension({ name, accounts })`, which installs itself |
| `publish(accounts)` | `setAccounts(accounts)` |
| `enable.mock.calls` | `enableCalls()`, one app name per call |
| the `signRaw` mock (signet) and `signer.signRaw` (talisman-web) | `signRawCalls()`; signatures resolve `FAKE_SIGNATURE` |
| `heldWallet(accounts)` with `approve()` and `refuse()` (signet) | `{ enable: "hold" }` with `resolveEnable()` and `rejectEnable()`, which rejects with `new Error("Rejected")` |
| `refusingWallet()` (talisman-web) | `{ enable: "reject" }` |
| `enableDelay.ms` (signet) | `{ enable: "hold" }`, then `resolveEnable()` after advancing the timers |
| `localStorage.setItem("kheopskit", JSON.stringify(cache))` (signet's `load`) | `store.rememberWallet(id)` and `store.setCachedState([cachedWalletOf(id, name)], [cachedAccountOf(wallet, address, name)])` |
| `vi.doMock("@kheopskit/core")` wrapping `getKheopskit$` in `takeUntil(disposed$)` (signet's `load`) | unsubscribe from `getKheopskit$` and `store.destroy()`; unsubscribing stops kheopskit's timers |
| `vi.unstubAllGlobals()` | `uninstall()` on each fake |

Two things stay in the apps. The kit has no hook to make `disconnect` fail,
so signet's `disconnectFailure` keeps its `getKheopskit$` wrapper. An extension
that returns a broken `enable()` result, such as signet's
`broken.enable.mockResolvedValue(...)`, stays a hand-written entry next to the
fakes on `window.injectedWeb3`.

An app that calls `getKheopskit$` without a `store` persists to
`localStorage`. Seed it with `createKheopskitStore()`, then call `destroy()` on
that seeding store. The seeded data uses `remembered`, not v5's `autoReconnect`.

---

## 7. Placeholders carry `isPlaceholder`

### The union

Every wallet and account in `kheopskit$` and in the hydrated snapshot carries
`isPlaceholder`. It is `true` for an item restored from the cache that its live
counterpart has not replaced yet, and `false` otherwise. Each platform type is a
union on it:

| Type | Absent on a placeholder |
|------|-------------------------|
| `PolkadotAccount` | `txCreator` (polkadot-api v3) or `polkadotSigner` (v2), `signRaw` |
| `EthereumAccount` | `client` |
| `SolanaAccount` | `signer`, `getSigner` |
| `PolkadotInjectedWallet` | `extension`, `sourceId` |
| `EthereumInjectedWallet` | `provider`, `sourceId` |
| `SolanaInjectedWallet` | `wallet`, `chains`, `sourceId` |
| `WalletConnectWallet` | `appKit` |

In v5 these fields were typed as present and were `undefined` at runtime until
hydration ended. In v6 the placeholder type marks them absent, so reading one
without narrowing yields a possibly-`undefined` value, and using it as present
(calling it, passing it where the handle is required) fails to compile until
you narrow:

```ts
// v5: compiles, throws while hydrating
await account.txCreator.signBytes(bytes);
// v6
if (account.isPlaceholder) return;
await account.txCreator.signBytes(bytes);
```

A placeholder wallet is never connected (`isConnected: false`). A cached wallet
that kheopskit has already discovered is not a placeholder. It carries its live
`connect()` and `disconnect()` and shows `status: "connecting"` while its
reconnect is pending. A Polkadot wallet's `extension` stays `undefined` until
that reconnect succeeds. Its
cached accounts stay placeholders until the live accounts replace them.

Plugins never set the flag. Kheopskit sets it on every item it emits, so a
custom plugin's wallet and account types type it as `isPlaceholder?: false`.

### `connect()` on a placeholder

| | v5 | v6 |
|---|----|----|
| `connect()` | throws `PendingWalletError` synchronously | waits for the live wallet with the same id and calls its `connect(options)`; rejects `WALLET_PENDING` if hydration ends without it, `ABORTED` if `signal` fires or the subscription ends first |
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

---

## 8. Discovery, hydration end and persistence

### New state field: `isDiscovering`

`KheopskitState.isDiscovering` is new and required. It is `true` until the
last read of `window.injectedWeb3`, 1100 ms after `load` or after subscribe,
whichever is later, so the emission that turns it `false` already lists every
Polkadot extension injected before that read. With `config.walletConnect`, it
also waits for the connector to load. It is always `true` on the server.

Kheopskit reads the Polkadot registry at subscribe and 100, 300, 600 and
1100 ms after it, as in 5.x. At `load` it starts the same schedule again, and
drops the subscribe reads still pending. An extension that injects after the
1100 ms read but before `load`, or up to 1100 ms after `load`, is listed
without a reload. A wallet that injects after the last read is not listed
until the next subscription. On the server kheopskit reads once and sets no
timer.

A state literal or test mock typed as `KheopskitState` must add the field:

```diff
  const state: KheopskitState = {
    wallets: [],
    accounts: [],
    config,
    isHydrating: false,
+   isDiscovering: false,
  };
```

Hydration waits for discovery only while a cached wallet has not been
discovered. When every cached wallet injects early, `isHydrating` ends at the
grace period without waiting for `load`. A cached wallet that has not appeared
holds it until discovery ends or `hydrationTimeout`, whichever comes first. A
`hydrationGracePeriod` of `0` still turns hydration off in `kheopskit$`. Under
`KheopskitProvider`, the first render still shows the cached placeholders with
`isHydrating: true` until the first emission.

### New option: `hydrationTimeout`

```ts
hydrationTimeout: number // default 3000
```

The upper bound in milliseconds on `isHydrating`. `hydrationGracePeriod` is now
only the minimum time placeholders are shown; `0` still disables them in
`kheopskit$`, though not in `KheopskitProvider`'s first render.
`hydrationTimeout` replaces the old cap of six times `hydrationGracePeriod` and
wins over a longer grace period, so an app that raised `hydrationGracePeriod`
sets `hydrationTimeout` as well. To keep the old cap, set it to six times the
grace period.

### New end rule

`isHydrating` turns `false` once `hydrationGracePeriod` has elapsed and every
cached wallet has settled. A cached wallet missing from the discovered wallets
settles when discovery ends (`isDiscovering` is `false`). A discovered one
settles at once unless it hydrated as `connecting`. Then it settles when
connected once its account list has been read (an empty list counts) or
connected with no cached accounts, disconnected with `error` set, or
disconnected and not remembered when hydration began. At `hydrationTimeout`
hydration ends whatever is pending, and a wallet whose reconnect is still
pending stays `connecting`.

"Its account list has been read" relies on a signal the built-in plugins send.
A custom `KheopskitPlatform` plugin, or a wrapper that pipes a built-in
plugin's `getAccounts$`, does not send it. Such a wallet settles on its first
listed account, as in 5.x, and a reconnected wallet with cached accounts that
now lists none holds hydration until `hydrationTimeout`.

- When every cached wallet is discovered and settled, hydration ends at the
  grace period, without waiting for `load`.
- A wallet that reconnects without sharing any account with the site settles
  as soon as it answers; its cached accounts leave the list when hydration
  ends.
- A failed reconnect ends that wallet's wait, even when the reconnect policy
  still permits a retry. A retry runs only on the next change to the wallet
  list (a wallet discovered or removed, or any wallet's status changing), which
  may never happen, so waiting
  for it would hold most failed reconnects until `hydrationTimeout`. A retry
  that does run shows on the live wallet's `status`, not as a placeholder.
- A remembered wallet the user disconnects during or right after its reconnect
  holds hydration, and shows its cached accounts, until `hydrationTimeout`.
- A prompt the extension opens for a revoked site holds hydration until the
  user answers or `hydrationTimeout` elapses. After a refusal the wallet is
  forgotten, so the next load opens no prompt.

In practice, hydration no longer runs to 3 s. With `autoReconnect: false` and
the extension installed, it ends at the grace period. With the extension
removed, it ends when discovery ends, 1100 ms after `load` or after subscribe,
whichever is later (or once a WalletConnect connector has loaded, if later),
or at `hydrationTimeout` if that comes first.

### Persistence guarantee

The cache is written after hydration ends, one second after the state
stabilises, as before. When it is written, a wallet whose `status` is
`connecting` keeps its previous cached entry and its previous cached accounts;
every other wallet is written from live data. A reconnect slower than the
debounce no longer overwrites a connected cache with `isConnected: false` and
no accounts, and a wallet the user connects while another wallet's prompt is
still open is persisted.

### What downstream apps delete

- A wait for `isHydrating` padded for the 3 s cap, or a `hydrationGracePeriod:
  0` chosen to avoid it. The default grace period ends hydration when the facts
  allow.
- A guard that re-seeds the cache after a reload because kheopskit could write
  it empty.

---

## 9. `@kheopskit/react`: one shared instance and wallet hooks

`useWallets`, `useAccounts` and `KheopskitProvider` keep their signatures.
Their results are v6 state, so they change the way sections 4, 7 and 8 describe.
A mock of `useWallets()` adds `isDiscovering`, a wallet built by hand adds
`status`, and code that reads an SDK handle or calls `signRaw` narrows on
`isPlaceholder` first:

```diff
  const mock: ReturnType<typeof useWallets> = {
    config,
    wallets: [],
    accounts: [],
    isHydrating: false,
+   isDiscovering: false,
  };

  const { accounts } = useWallets<typeof platforms>();
  const account = accounts.find((a) => a.id === accountId);
- if (account?.platform === "polkadot")
+ if (account?.platform === "polkadot" && !account.isPlaceholder)
    await account.txCreator.signBytes(bytes);
```

### Context shape (internal)

The provider's context now carries an external store (`subscribe`,
`getSnapshot`, `getServerSnapshot`) instead of `{ state }`. Only code that read
`KheopskitContext` directly sees the change. The package does not export it.

### Unmounting the provider stops kheopskit

In v5, unmounting `KheopskitProvider` left its `kheopskit$` subscription open,
so the pipeline kept running and persisting state changes. In v6 the provider subscribes while
it is mounted and unsubscribes on unmount, and the pipeline stops once no
subscriber is left.

### Additions

| Addition | What it does |
|----------|--------------|
| `createKheopskit(config, { store? })` returns `kheopskit$` and `store` | the stream its provider subscribes to and the store that stream persists into; code outside React subscribes to the same pipeline |
| `useWallet(walletId)`, `useAccount(accountId)` | one item or `undefined`; re-render only when that item changes; also returned by `createKheopskit`, typed to its platforms |
| `useConnect(walletId)` | `{ connect, disconnect, status, error }`; aborts a pending `connect()` on unmount or when `walletId` changes; rejects `ABORTED` a `connect()` that starts after either |
| wallet actions act on the instance's pipeline | `connect` and `disconnect` from `useWallet` and `useWallets`, and `disconnect` from `useConnect`, act on the instance's pipeline when they are called, while any provider of the instance or any `kheopskit$` subscriber holds it, and wait for its first emission after an `<Activity>` reveal restarts it; called once nothing holds the pipeline, they reject `ABORTED` without restarting it. `useConnect`'s `connect` is component-scoped. It rejects `ABORTED` once its component has unmounted or been hidden by `<Activity>`, even while something else holds the pipeline |
| `store` prop on `KheopskitProvider` | the store the provider persists into, such as a memory store in tests |

See the [React README](../react/README.md#one-instance-for-react-and-rxjs-code).

### What downstream apps delete

- A second `getKheopskit$` call next to the provider for RxJS code. Subscribe
  to the `kheopskit$` returned by `createKheopskit`.
- Components that read `useWallets()` only to find one wallet or account. Use
  `useWallet` or `useAccount`.
- An `AbortController` kept in a ref to cancel `connect()` on unmount. Use
  `useConnect`.
