# Migrating to Kheopskit v6

v6 renames the store's remembered list, keeps the extension's account order,
and changes how the Polkadot plugin talks to an extension: kheopskit calls
`enable()` itself, keeps the raw object the extension returns, and exposes raw
signing on every account.

`@kheopskit/core`, `@kheopskit/react` and the repo release tag move to
**`6.0.0`** together.

This guide grows with each v6 change. Each section covers one area.

---

## At a glance

| Area | v5 | v6 |
|------|----|----|
| `wallet.extension` on a Polkadot wallet | pjs-signer's `InjectedExtension` (`getAccounts`, `subscribe`, `disconnect`) | the raw `enable()` result, typed `PolkadotInjected` (`accounts`, `signer`) |
| Raw signing | `txCreator.signBytes(bytes)` only, hex with `type: "bytes"` | plus `account.signRaw(data, { type? })`, text or bytes |
| `ethereum` accounts | signer built with type `ethereum`, 64-byte mock signature | signer built with `ecdsa`, 65-byte mock signature |
| Extension account subscription | kept after disconnect | released on disconnect and on teardown |
| `readonly`, `partOfPortfolio` (Talisman, its own origins) | present at runtime, not typed | typed on `PolkadotAccount` |
| Test kit | none; apps fake `injectedWeb3` themselves | `@kheopskit/core/testing` |

---

## Store

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

## Polkadot: raw signing and the injected handle

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

`connect()` rejects, and the wallet stays disconnected and unremembered, when
the `enable()` result lacks `accounts.get`, `accounts.subscribe`,
`signer.signPayload` or `signer.signRaw`. An account kheopskit cannot build is
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

---

## Test kit

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
