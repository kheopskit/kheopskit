# @kheopskit/core

Framework-agnostic core for [Kheopskit](https://github.com/kheopskit/kheopskit) —
list wallets and accounts across Polkadot, Ethereum and Solana, with injected
wallets and WalletConnect (Reown AppKit).

For React, use [`@kheopskit/react`](https://www.npmjs.com/package/@kheopskit/react).
Full docs and the interactive playground: https://github.com/kheopskit/kheopskit

> **Upgrading from v3?** v4 moves platforms to plugins and makes platform SDKs
> (and WalletConnect) optional peer dependencies. See
> [MIGRATING_TO_V4.md](./MIGRATING_TO_V4.md).

> **Upgrading from v5?** v6 changes the `connect()`/`disconnect()` contract and
> the error codes. See [MIGRATING_TO_V6.md](./MIGRATING_TO_V6.md).

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

`wallet.connect()` and `wallet.disconnect()` are safe to call straight from UI
code. Concurrent `connect()` calls on one wallet share one platform attempt, so
the extension is asked once, and each call gets its own promise. A repeat call
on a wallet that is already connected (or disconnected) resolves at once.
`connect({ signal })` rejects that caller with a `KheopskitError` of code
`ABORTED` when the signal fires before the platform answers. An abort after the
platform granted the connect changes nothing. A refused prompt rejects with
`USER_REJECTED` and any other failure with `CONNECT_FAILED`. Both carry the
platform error as `cause`. `connect()` resolves only after `kheopskit$` has
emitted the wallet with `isConnected: true`. On platforms that list accounts
asynchronously (Ethereum `eth_accounts`) the accounts may arrive in a later
emission. No emission shows a disconnected wallet still listing accounts.
Until a fix tracked for 6.0.0 lands, an Ethereum wallet that reconnects while
another connected Ethereum wallet's `eth_accounts` request is pending may show
the accounts of its previous connection for as long as that request goes
unanswered, and `connect()` may resolve on that emission. `disconnect()`
resolves once it has emitted `isConnected: false`, or once a later `connect()`
or the end of the subscription makes that emission impossible. After the last
subscriber has unsubscribed, `connect()` and `disconnect()` on a wallet object
from that subscription reject `ABORTED` without asking the platform. There is
no default timeout: pass `AbortSignal.timeout(ms)` to cap the wait for the
platform's answer.

`state.isDiscovering` is `true` until the page has fired `load` and kheopskit
has read `window.injectedWeb3` again, so the emission that turns it `false`
already lists every Polkadot extension injected by then. Wait for it before you
conclude that a wallet is missing. It is `false` from the first emission when you
subscribe after `load`, and always `true` on the server. It says nothing about
wallets that inject after `load`.

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

### Reconnect and wallet status

Every wallet carries `status` (`disconnected`, `connecting` or `connected`;
`isConnected` is `status === "connected"`) and `error`, the last connect the
platform refused or failed, cleared when the next attempt starts. On a reload,
a remembered wallet kheopskit will reconnect is `connecting` from the first
frame until the extension answers. A reconnect never prompts while the site
stays authorised in the extension. When the authorisation was revoked the
extension prompts once; a refusal forgets the wallet and the next load stays
silent. Any other failure sets `error`, keeps the wallet remembered and is
retried up to three times when discovery changes. A manual `connect()` or
`disconnect()` on a remembered wallet ends its automatic reconnect for the
session, so a disconnect the user makes is never undone.

`autoReconnect` governs injected wallets and is `true` by default. Pass `false`
to reconnect none of them, or a
synchronous, pure function to choose per wallet (it runs on the server and on
the client against the cached placeholder, so key on `wallet.id`):

```ts
getKheopskit$({
  platforms: [polkadot()],
  autoReconnect: (wallet) => wallet.id === "polkadot:talisman",
});
```

A wallet the function rejects shows `disconnected` from the first frame, without
its cached accounts. Every successful connect is remembered whatever this option
says, so an app can turn reconnect on later. The WalletConnect row follows
AppKit's own session restore and hydrates `connecting` while AppKit restores.
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

### Hydration end

`isHydrating` turns `false` as soon as the facts allow: `hydrationGracePeriod`
(default 500 ms) elapsed, `isDiscovering` is `false`, and every remembered
wallet kheopskit reconnects is settled (connected with its accounts read,
failed with `error`, or absent from the discovered wallets). `hydrationTimeout`
(default 3000 ms) is the upper bound: when it elapses first, hydration ends
and a wallet whose reconnect is still pending stays `connecting`. With the
extension gone, hydration ends at the grace period, not at the timeout. A
prompt the extension opens for a revoked site holds hydration until the user
answers or the timeout elapses, once; after a refusal the wallet is forgotten
and the next load hydrates at the grace period.

The cache is written after hydration ends, one second after the state
stabilises. A wallet still `connecting` at that time keeps its previous cached
entry and accounts, so a slow reconnect never writes an empty cache, while
every other wallet is written as it is.

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
