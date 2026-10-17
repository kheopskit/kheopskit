# Migrating to Kheopskit v6

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
