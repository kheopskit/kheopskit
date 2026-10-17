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
kheopskit does not wrap. `connect()` reads `accounts.get()` before it resolves,
so the emission that first shows the wallet connected already lists its
accounts, and a rejected `accounts.get()` fails the connect with
`CONNECT_FAILED`.

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

## Testing

`@kheopskit/core/testing` runs kheopskit in a test without a browser
extension. It has no test-runner dependency, so it works with vitest and jest.

- `createFakePolkadotExtension(options?)` installs a fake extension on
  `window.injectedWeb3[name]`. `options.name` defaults to `"fake-extension"`.
  `options.accounts` is the account list. `options.enable` sets how `enable()`
  answers: `"resolve"` (the default) at once, `"reject"` at once with
  `new Error("Rejected")`, which `connect()` reports as `USER_REJECTED`, or
  `"hold"` until the test calls `resolveEnable()` or `rejectEnable(error?)`.
- The fake returns `{ name, walletId, setAccounts, resolveEnable, rejectEnable,
  enableCalls, signRawCalls, uninstall }`. `setAccounts(accounts)` pushes the
  list to every `accounts.subscribe` listener. `enableCalls()` lists the app
  name of each `enable()` call. `signRaw` and `signPayload` resolve
  `FAKE_SIGNATURE`, and `signRawCalls()` lists what `signRaw` received.
- `createMemoryStorage()` returns a `SyncableStorage` held in memory, for
  `createKheopskitStore({ storage })`. Stores created on the same instance see
  each other's writes.
- `cachedWalletOf(walletId, name)` and `cachedAccountOf(wallet, address,
  name?)` build the entries `store.setCachedState(wallets, accounts)` takes, so
  a test seeds a previous session without writing the persisted shape.

A vitest test that seeds a remembered wallet and checks that it reconnects:

```ts
import {
  createKheopskitStore,
  getKheopskit$,
  type KheopskitState,
  type KheopskitStore,
} from "@kheopskit/core";
import { polkadot } from "@kheopskit/core/polkadot";
import {
  cachedAccountOf,
  cachedWalletOf,
  createFakePolkadotExtension,
  createMemoryStorage,
  type FakePolkadotExtension,
} from "@kheopskit/core/testing";
import type { Subscription } from "rxjs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const alice = {
  address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
  name: "Alice",
  type: "sr25519" as const,
};

let talisman: FakePolkadotExtension;
let store: KheopskitStore;
let subscription: Subscription;

beforeEach(() => {
  vi.useFakeTimers();
  talisman = createFakePolkadotExtension({ name: "talisman", accounts: [alice] });
  store = createKheopskitStore({ storage: createMemoryStorage() });
});

afterEach(() => {
  talisman.uninstall();
  subscription.unsubscribe();
  store.destroy();
  vi.useRealTimers();
});

it("reconnects the wallet the user connected last time", async () => {
  const wallet = cachedWalletOf(talisman.walletId, "Talisman");
  store.rememberWallet(talisman.walletId);
  store.setCachedState([wallet], [cachedAccountOf(wallet, alice.address, alice.name)]);

  let state: KheopskitState | undefined;
  subscription = getKheopskit$({ platforms: [polkadot()] }, { store }).subscribe(
    (next) => {
      state = next;
    },
  );
  await vi.advanceTimersByTimeAsync(1000);

  expect(talisman.enableCalls()).toHaveLength(1);
  expect(state?.wallets.map((w) => [w.id, w.isConnected])).toEqual([
    ["polkadot:talisman", true],
  ]);
  expect(state?.accounts.map((a) => a.name)).toEqual(["Alice"]);
});
```


Tear down with three calls:

```ts
talisman.uninstall();
subscription.unsubscribe();
store.destroy();
```

Unsubscribing from `getKheopskit$` stops every timer it started, among them
discovery polling, the hydration grace period and the 1 second debounced
persist. Without it, a persist can write to storage after the test ended. `store.destroy()` ends
the store's storage subscription. `uninstall()` removes the fake from
`window.injectedWeb3`, and removes `window.injectedWeb3` once it is empty.

With fake timers, advance time with `vi.advanceTimersByTimeAsync` (jest:
`jest.advanceTimersByTimeAsync`). Kheopskit settles connects and reconnects in
promises, and the async variants run those microtasks between timers. The
synchronous variants leave them pending.

When the code under test calls `getKheopskit$` without a `store`, it uses
`localStorage`. Seed it through a store on the same storage, then destroy that
store:

```ts
const seed = createKheopskitStore();
seed.rememberWallet("polkadot:talisman");
seed.destroy();
```

The kit fakes Polkadot extensions only.

## License

ISC
