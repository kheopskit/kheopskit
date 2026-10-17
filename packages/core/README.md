# @kheopskit/core

Framework-agnostic core for [Kheopskit](https://github.com/kheopskit/kheopskit) —
list wallets and accounts across Polkadot, Ethereum and Solana, with injected
wallets and WalletConnect (Reown AppKit).

For React, use [`@kheopskit/react`](https://www.npmjs.com/package/@kheopskit/react).
Full docs and the interactive playground: https://github.com/kheopskit/kheopskit

> **Upgrading from v3?** v4 moves platforms to plugins and makes platform SDKs
> (and WalletConnect) optional peer dependencies. See
> [MIGRATING_TO_V4.md](./MIGRATING_TO_V4.md).

## Install

`rxjs` is always required; every platform SDK (and WalletConnect) is an optional
peer dependency — install only what you use:

```bash
pnpm add @kheopskit/core rxjs

pnpm add polkadot-api                                            # Polkadot
pnpm add viem mipd                                               # Ethereum
pnpm add @solana/kit @wallet-standard/app @wallet-standard/base  # Solana
pnpm add @reown/appkit                                           # WalletConnect (optional)
```

A Polkadot-only dapp that doesn't use WalletConnect installs none of the
Ethereum/Solana SDKs nor `@reown/appkit`, and none of their code is bundled.

## Usage

Platforms are enabled by passing **plugins** (imported from their entry points)
to `config.platforms`:

```ts
import { getKheopskit$ } from "@kheopskit/core";
import { polkadot } from "@kheopskit/core/polkadot";
import { ethereum } from "@kheopskit/core/ethereum";
import { solana } from "@kheopskit/core/solana";

const kheopskit$ = getKheopskit$({
  platforms: [
    polkadot({ accountTypes: ["sr25519", "ed25519", "ecdsa"] }),
    ethereum(),
    solana({ chain: "solana:mainnet" }),
  ],
  appName: "My Dapp", // shown by Polkadot extensions; defaults to walletConnect.metadata.name, then the hostname
  autoReconnect: true,
});

kheopskit$.subscribe(({ wallets, accounts, isHydrating }) => {
  // ...
});
```

Each platform entry point also exports its SDK-precise types
(`PolkadotAccount`, `EthereumAccount`, `SolanaAccount`, …). The root export
carries the SDK-free `KheopskitConfig`, `KheopskitState`, `BaseWallet` and
`BaseWalletAccount`.

> While `state.isHydrating` is `true`, wallets/accounts are cached placeholders
> carrying only the base fields — SDK fields (`signer`, `client`,
> provider/extension handles) are absent until hydration completes.

`state.isDiscovering` is `true` until the page has fired `load` and kheopskit
has read `window.injectedWeb3` again, so the emission that turns it `false`
already lists every Polkadot extension injected by then. Wait for it before you
conclude that a wallet is missing. It is `false` from the first emission when you
subscribe after `load`, and always `true` on the server. It says nothing about
wallets that inject after `load`.

`account.signRaw(data, options?)` on a Polkadot account signs arbitrary data
with the wallet's raw signing call and resolves the hex signature. A string is
sent as text with `type: "payload"` and a `Uint8Array` as `0x` hex with
`type: "bytes"`; an explicit `options.type` is sent as given for either input.
A hex-looking string is sent as text, so pass a `Uint8Array` for bytes and a
string for a Sign-In With Substrate message. Talisman opens its Sign In screen
for a string that parses as a SIWS message (`Version: 1.0.0`) and a generic
Sign Request screen for hex; the screen follows the text `data`, not `type`.
Enkrypt reads `type` as the encoding of `data`, so it needs the value the
derived default sends. On a connected Polkadot wallet, `wallet.extension` is the raw object
`enable()` returned, typed as `PolkadotInjected`. Use it for extension calls
kheopskit does not wrap.

## Persisted store

Kheopskit remembers which wallets the user connected and caches the last wallet
and account lists, so a reload paints the previous state before the extensions
answer.

The data lives under the key `kheopskit` (change it with the `storageKey`
config option). In the browser it goes to `localStorage` as JSON:

```json
{
  "remembered": ["polkadot:talisman"],
  "cachedWallets": [
    { "id": "polkadot:talisman", "platform": "polkadot", "type": "injected", "name": "Talisman", "isConnected": true }
  ],
  "cachedAccounts": [
    { "id": "polkadot:talisman::5Grw…", "platform": "polkadot", "address": "5Grw…", "name": "Alice", "polkadotAccountType": "sr25519", "walletId": "polkadot:talisman", "walletName": "Talisman" }
  ]
}
```

- `remembered` lists the wallets the user connected. A wallet is added on every
  successful connect and removed on disconnect. When `autoReconnect` is on, these
  wallets reconnect on the next load.
- `cachedWallets` and `cachedAccounts` are written 1 second after the live state
  settles (the write is debounced), and only when a persisted field changed.
  Only accounts of connected wallets are cached.

With `ssrCookies`, the same data goes to a `kheopskit` cookie in a compact form,
to stay under the cookie size limit:

```json
{ "v": 1, "r": ["polkadot:talisman"], "w": [["polkadot:talisman", "Talisman", 1, 0]], "a": [["polkadot:talisman", "5Grw…", "Alice", null, 0, 0]] }
```

`r` is `remembered`, `w` holds `[id, name, isConnected, type]` per wallet and
`a` holds `[walletId, address, name, chainId, polkadotType, platform]` per
account.

Data written before v6 stored `remembered` as `autoReconnect`. The store reads
that field as `remembered` and drops it on the next write.

### Custom storage

`createKheopskitStore` accepts a `storage` option, which takes precedence over
`ssrCookies` and `localStorage`. Pass the store to `getKheopskit$`:

```ts
import {
  createKheopskitStore,
  getKheopskit$,
  type SyncableStorage,
} from "@kheopskit/core";

const entries = new Map<string, string>();
const storage: SyncableStorage = {
  getItem: (key) => entries.get(key) ?? null,
  setItem: (key, value) => entries.set(key, value),
  removeItem: (key) => entries.delete(key),
};

const store = createKheopskitStore({ storage });
const kheopskit$ = getKheopskit$(config, { store });

// When done with the store
store.destroy();
```

`subscribe` is optional; implement it to receive changes made by other tabs.
The store holds that subscription only while `store.observable` has subscribers.
`store.destroy()` completes `store.observable`, which ends it.
`store.rememberWallet(walletId)` and `store.forgetWallet(walletId)` edit the
remembered list directly.

## License

ISC
