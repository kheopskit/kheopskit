# Migrating to Kheopskit v6

v6 tightens the wallet connection contract. `connect()` and `disconnect()` are
safe to call from UI code, rejections are typed, and no emission of the state
stream shows a disconnected wallet still listing accounts or a connected wallet
listing the accounts of a previous connection. v6 also renames the store's
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
| When `connect()` resolves | when the platform call returned | after `kheopskit$` emitted the wallet with `isConnected: true`; accounts a platform lists asynchronously (Ethereum `eth_accounts`) may follow in a later emission |
| Intermediate emissions | a wallet could show connected with the previous connection's accounts for one frame | a synchronous burst is one emission; no emission shows a disconnected wallet still listing accounts or a connected wallet listing a previous connection's accounts |
| Account streams | one read per platform, re-run for every wallet of the platform whenever any wallet changes | one stream per wallet connection, started empty; a sibling's connect or disconnect leaves it alone and its pending request delays nobody |
| `wallet.extension` on a Polkadot wallet | pjs-signer's `InjectedExtension` (`getAccounts`, `subscribe`, `disconnect`) | the raw `enable()` result, typed `PolkadotInjected` (`accounts`, `signer`) |
| Raw signing | `txCreator.signBytes(bytes)` only, hex with `type: "bytes"` | plus `account.signRaw(data, { type? })`, text or bytes |
| `ethereum` accounts | signer built with type `ethereum`, 64-byte mock signature | signer built with `ecdsa`, 65-byte mock signature |
| Extension account subscription | kept after disconnect | released on disconnect and on teardown |
| `readonly`, `partOfPortfolio` (Talisman, its own origins) | present at runtime, not typed | typed on `PolkadotAccount` |
| Test kit | none; apps fake `injectedWeb3` themselves | `@kheopskit/core/testing` |

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
- `INVALID_CONFIG`: `getKheopskit$` throws it synchronously when
  `config.walletConnect` is not a plugin created by `walletConnect()` from
  `@kheopskit/core/walletconnect` (see section 5). It is not a rejection and
  carries no `walletId`.

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
  disconnected wallet still listing accounts or a connected wallet listing the
  accounts of a previous connection.
- **No default timeout.** A Polkadot extension prompt pends until the user
  answers it. Pass `AbortSignal.timeout(ms)` to cap your wait for the platform's
  answer. The wait for the state after a grant is not capped. Aborting ends
  your wait; it cannot close the extension's own prompt. Once no caller waits
  any more, a handle the extension returns afterwards is released, and the
  wallet is neither connected nor remembered.
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
- **WalletConnect is unchanged.** The connector's `connect()` opens the modal
  and resolves once it is open; `isConnected` follows when the user approves.
- **No throttle on the stream.** `throttleTime(16)` is replaced by a microtask
  coalesce: a synchronous burst (wallets, then accounts) becomes one emission,
  so no emission shows a disconnected wallet still listing accounts. A wallet's
  accounts leave the state in the same emission that shows it disconnected,
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
  One exception: the first value of a platform plugin's `getAccounts$`, called
  directly with wallets that are already connected, waits until each of them
  has answered. `kheopskit$` subscribes before any wallet is connected, so it
  never waits.

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
accounts from `state.accounts`; kheopskit owns the subscription. As in v5,
`connect()` reads `accounts.get()` before it resolves, so the emission that
first shows the wallet connected already lists its accounts; the list then
follows `accounts.subscribe`. The field is `undefined` while the wallet is
disconnected, and a placeholder (section 7) has none.

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
if (account.isPlaceholder) return;
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
`accounts.subscribe`, `signer.signPayload` or `signer.signRaw`, or when
`accounts.get()` rejects. `cause` holds an `Error` whose message names the
extension, for example `Unsupported extension: "talisman"`, or the extension's
own error. An account kheopskit cannot build is skipped and the wallet's other
accounts are listed.

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

---

## 4. Wallet status and reconnect

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
session, so a disconnect the user makes is never undone. Automatic reconnect
also ends when the wallet disappears mid-attempt; the wallet stays remembered
for the next load. Nothing is written to `console.error` any more;
`debug: true` logs the failure with `console.debug`.

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

Dapps that never set `walletConnect` change nothing in their code. Their bundle
shrinks. A Polkadot-only Vite app built against 5.3.0 and against 6.0.0, with
`@reown/appkit` installed (as it is when another dependency pulls it in):

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
