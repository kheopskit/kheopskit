# @kheopskit/core

Framework-agnostic core for
[Kheopskit](https://github.com/kheopskit/kheopskit). It lists wallets and
accounts across Polkadot, Ethereum and Solana, with injected wallets and
WalletConnect (Reown AppKit).

For React, use
[`@kheopskit/react`](https://www.npmjs.com/package/@kheopskit/react). Full
docs and the interactive playground are at
https://github.com/kheopskit/kheopskit.

> **Upgrading from v3?** v4 moves platforms to plugins and makes platform SDKs
> (and WalletConnect) optional peer dependencies. See
> [MIGRATING_TO_V4.md](./MIGRATING_TO_V4.md).

> **Upgrading from v5?** v6 makes `connect()` shared, idempotent and
> abortable, types its rejections, adds `status`, `isDiscovering`,
> `isPlaceholder` and `signRaw`, and moves WalletConnect to a plugin. See
> [MIGRATING_TO_V6.md](./MIGRATING_TO_V6.md).

## Install

`rxjs` is always required. Every platform SDK (and WalletConnect) is an
optional peer dependency, so install only what you use:

```bash
pnpm add @kheopskit/core rxjs

pnpm add polkadot-api                                            # Polkadot
pnpm add viem mipd                                               # Ethereum
pnpm add @solana/kit @wallet-standard/app @wallet-standard/base  # Solana
pnpm add @reown/appkit                                           # WalletConnect (optional)
```

A Polkadot-only dapp that doesn't use WalletConnect installs none of the
Ethereum/Solana SDKs nor `@reown/appkit`, and none of their code is bundled.

WalletConnect is a plugin from its own entry point, so only a dapp that imports
`@kheopskit/core/walletconnect` bundles AppKit:

```ts
import { getKheopskit$ } from "@kheopskit/core";
import { polkadot } from "@kheopskit/core/polkadot";
import { walletConnect } from "@kheopskit/core/walletconnect";
import { defineChain } from "@reown/appkit/networks";

const polkadotNetwork = defineChain({
  id: "91b171bb158e2d3848fa23a9f1c25182",
  name: "Polkadot",
  nativeCurrency: { name: "Polkadot", symbol: "DOT", decimals: 10 },
  rpcUrls: { default: { http: ["https://rpc.polkadot.io"] } },
  chainNamespace: "polkadot",
  caipNetworkId: "polkadot:91b171bb158e2d3848fa23a9f1c25182",
});

const kheopskit$ = getKheopskit$({
  platforms: [polkadot()],
  walletConnect: walletConnect({
    projectId: "<your Reown project id>",
    metadata: { name: "My Dapp", description: "", url: "https://my.dapp", icons: [] },
    networks: [polkadotNetwork],
  }),
});
```

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
  appName: "My Dapp", // shown by Polkadot extensions; defaults to the WalletConnect metadata name, then the hostname
  autoReconnect: true,
});

kheopskit$.subscribe(({ wallets, accounts, isHydrating, isDiscovering }) => {
  // ...
});
```

[Wallet lifecycle](#wallet-lifecycle) explains what each field means over a
page load, with every default and delay.

Each platform entry point also exports its SDK-precise types
(`PolkadotAccount`, `EthereumAccount`, `SolanaAccount`, …). The root export
carries the SDK-free `KheopskitConfig`, `KheopskitState`, `BaseWallet` and
`BaseWalletAccount`.

## Wallet lifecycle

A page load runs these steps in order. Kheopskit discovers the installed
wallets, paints the cached state as placeholders, reconnects the wallets the
user connected last time, ends hydration, and writes the new state to the
cache. A user's `connect()` or `disconnect()` can happen at any point. Each
subsection below gives the rules and the numbers, and links the source that
implements them.

### Discovery

Source: [`api/polkadot/wallets.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/api/polkadot/wallets.ts),
[`utils/registryReads.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/utils/registryReads.ts),
[`utils/pageLoad.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/utils/pageLoad.ts),
[`api/kheopskit.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/api/kheopskit.ts).

Polkadot extensions register themselves on `window.injectedWeb3` and send no
event, so kheopskit reads that registry on a fixed schedule:

- At subscribe, then 100, 300, 600 and 1100 ms after subscribe.
- When `window` fires `load`, then 100, 300, 600 and 1100 ms after `load`. The
  subscribe reads still pending at `load` are dropped. A subscription that
  starts after `load` has only the subscribe reads.

The read window ends 1100 ms after `load` or after subscribe, whichever is
later. Nothing reads the registry after that, so a wallet that injects later
is not listed until the next subscription, usually the next page load.
Kheopskit has no `refreshWallets()` and does not read again on focus or on
connect. On the server it reads once and sets no timer.

Ethereum (EIP-6963, through `mipd`) and Solana (Wallet Standard) wallets
announce themselves with events, so those lists update whenever a wallet
announces or unregisters.

`state.isDiscovering` tells you whether the list may still grow:

- `true` until the read window ends, 1100 ms after `load` or after subscribe,
  whichever is later.
- It turns `false` in the emission of the last read. That emission already
  lists every Polkadot extension injected by then. Wait for it before you
  conclude that a wallet is missing.
- Always `true` on the server.

In the end-to-end test `e2e/tests/discovery-at-load.spec.ts`, an extension
injected 1500 ms after the first read and before `load` showed in the wallet
list 23.9 ms after `load` on vite-react, and 13.1 to 23.9 ms across the three
example apps (the test's limit is 300 ms). The "Looking for wallets…" status
went away 1114 to 1124 ms after `load`.

### Hydration

Source: [`api/kheopskit.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/api/kheopskit.ts),
[`api/hydration.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/api/hydration.ts),
[`utils/createHydrationBuffer.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/utils/createHydrationBuffer.ts).

On a reload, the first emission shows the wallets and accounts of the previous
visit from the cache, so the list does not flash empty while the extensions
inject and the wallets reconnect. `state.isHydrating` is `true` while it does.
With nothing cached, or with `hydrationGracePeriod: 0`, `isHydrating` is
`false` from the first emission.

Items restored from the cache are placeholders, flagged `isPlaceholder: true`.
Each platform type is a union on that flag. A placeholder has no SDK handle
(`txCreator`, `polkadotSigner`, `signRaw`, `client`, `signer`, `getSigner`,
`provider`, `extension`, `wallet`, `appKit`, `sourceId`), so the compiler makes
you narrow before you sign:

```ts
if (account.isPlaceholder) return;
await account.txCreator.signBytes(bytes);
```

Reading a handle without narrowing gives `undefined` in the type, so the
compiler rejects a call on it. The plain fields of the cache (Ethereum
`chainId`, Polkadot key `type`) are restored on placeholders. Solana `chains`
is not cached, so a placeholder Solana account has none.

A placeholder wallet is never connected. Its `connect()` waits for kheopskit to
discover the live wallet with the same id and connects that one. It rejects
with `WALLET_PENDING` if hydration ends first, and with `ABORTED` if its
`signal` fires or the last subscriber unsubscribes while it waits. Its
`disconnect()` resolves at once. A cached wallet that kheopskit has already
discovered is no longer a placeholder. It carries its live `connect()` and
`disconnect()` and shows `status: "connecting"` while its reconnect runs, and
its `connect()` joins that reconnect. A Polkadot wallet's `extension` stays
`undefined` until that reconnect succeeds. No item is a placeholder once
`isHydrating` is `false`.

`isHydrating` turns `false` once all three hold:

1. `hydrationGracePeriod` has elapsed (default 500 ms).
2. Every cached wallet has been discovered, or discovery has ended
   (`isDiscovering` is `false`). When every cached wallet injects early,
   hydration does not wait for `load`. A cached wallet that has not appeared
   holds it until discovery ends.
3. Every discovered wallet that hydrated as `connecting` has settled. It has
   settled when connected once its account list has been read (an empty list
   counts) or connected with no cached accounts, disconnected with `error`
   set, or disconnected and not remembered when hydration began.

At `hydrationTimeout` (default 3000 ms) hydration ends whatever is pending, and
a wallet whose reconnect is still pending stays `connecting`. The timeout wins
over a longer grace period, so an app that raises `hydrationGracePeriod` sets
`hydrationTimeout` as well.

- A wallet that reconnects without sharing any account with the site settles
  as soon as it answers. Its cached accounts leave the list when hydration
  ends.
- A failed reconnect ends that wallet's wait, even when the reconnect policy
  still permits a retry.
- A remembered wallet the user disconnects during or right after its reconnect
  holds hydration, and shows its cached accounts, until `hydrationTimeout`.
- A prompt the extension opens for a revoked site holds hydration until the
  user answers or `hydrationTimeout` elapses.
- "Its account list has been read" relies on a signal that the built-in
  plugins send. A custom `KheopskitPlatform` plugin, or a wrapper that pipes a
  built-in plugin's `getAccounts$`, does not send it. For such a plugin, a
  reconnected wallet with cached accounts that now lists none holds hydration
  until `hydrationTimeout`.

Measured with Talisman 3.11.0 on vite-react, with the extension disabled and a
filled cache, hydration ended 633 ms after page start (subscribe at about
130 ms plus the 500 ms grace period), where v5 took 3 s. With the extension
present, the reloaded row read `Connecting…` at 176 ms and `Disconnect` at
282 ms. An extension re-enabled cold answered at 2667 ms, close to the 3000 ms
default, so raise `hydrationTimeout` if your users' wallets start slower.

The cache is written after hydration ends, 1 second after the state stops
changing (a debounce). The first write after hydration always happens; later
writes happen only when a persisted field or a wallet's `status` changed. A
wallet still `connecting` at that moment keeps its previous cached entry and
accounts, so a slow reconnect never writes an empty cache. Every other wallet is
written as it is, with the accounts of connected wallets only. See
[Persistence](#persistence) for the format.

### Reconnect

Source: [`api/wallets.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/api/wallets.ts),
[`api/reconnectPolicy.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/api/reconnectPolicy.ts),
[`api/injectedWallets.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/api/injectedWallets.ts).

Kheopskit adds an injected wallet to the store's `remembered` list on every
successful `connect()` and removes it when `disconnect()` starts on a
connected wallet, whatever `autoReconnect` says, so an app can turn reconnect
on later. On the next load it reconnects the remembered injected wallets that
`autoReconnect` accepts:

- `true` (the default) reconnects every remembered injected wallet, and
  `false` none.
- A function chooses per wallet. It is called for each cached connected
  injected wallet on the first frame, then for each remembered wallet with its
  live object before the attempt. It must be synchronous and pure. It runs on
  the server and on the client for the same input, and both must agree, or the
  markup diverges. It receives the `BaseWallet` fields only, so key on `id`.

```ts
getKheopskit$({
  platforms: [polkadot()],
  autoReconnect: (wallet) => wallet.id === "polkadot:talisman",
});
```

A cached connected wallet the function accepts shows `status: "connecting"`
from the first frame until its attempt settles. A wallet it rejects shows
`disconnected` from the first frame, without its cached accounts, so nothing
flashes from connected to disconnected. The cache records a connect 1 s after
the state settles. After a quicker reload, the first frame shows the wallet as
the previous cache had it, until its reconnect starts.

A reconnect opens no connect prompt while the site stays authorised in the
extension. When the authorisation was revoked, the extension prompts once. A
refusal (`USER_REJECTED`) forgets the wallet, so the next load stays silent.
Any other failure sets `wallet.error` and keeps the wallet remembered.
Kheopskit retries it on the next change to the wallet list (a wallet discovered
or removed, or any wallet's status changing), 3 attempts in total. If the list
never changes again, no retry runs. A manual `connect()` or `disconnect()` on a
remembered wallet ends its automatic reconnect for the session. A
`disconnect()` while the automatic reconnect still waits for the extension
aborts it without forgetting the wallet, so the next load reconnects it.
Automatic reconnect also ends when the wallet disappears mid-attempt, and the
wallet stays remembered for the next load.

Every wallet carries `status` (`disconnected`, `connecting` or `connected`) and
`error`. `isConnected` is `status === "connected"`. `error` is the last
`connect()` or reconnect that the platform refused (`USER_REJECTED`) or failed
(`CONNECT_FAILED`, or `FEATURE_NOT_SUPPORTED` for a Wallet Standard wallet
without `standard:connect`). The next attempt clears it, and an aborted
attempt sets nothing. With `debug: true`, a failed reconnect is logged with
`console.debug`.

The WalletConnect connector is not governed by `autoReconnect`. AppKit restores
its own session on load, and the connector hydrates `connecting` while it does.

### Connect and disconnect

Source: [`api/injectedWallets.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/api/injectedWallets.ts),
[`api/kheopskit.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/api/kheopskit.ts),
[`api/errors.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/api/errors.ts).

`wallet.connect()` and `wallet.disconnect()` are safe to call straight from UI
code:

- **Shared.** Concurrent `connect()` calls on one wallet share one platform
  attempt, so the extension is asked once. Each call gets its own promise.
- **Idempotent.** `connect()` on a connected wallet and `disconnect()` on a
  disconnected wallet resolve at once without asking the platform. A
  `connect()` made while a `disconnect()` still waits for the platform waits
  for that disconnect to settle, then connects if the wallet ended up
  disconnected.
- **Abortable.** `connect({ signal })` rejects that caller with `ABORTED` when
  the signal fires before the platform answers. Other callers keep waiting.
  The attempt itself is abandoned once every caller that passed a signal has
  aborted and no caller without one joined, on `disconnect()`, or when the
  last `kheopskit$` subscriber unsubscribes. An abort after the platform
  granted the connect changes nothing, and a Polkadot extension counts as
  granted only once its account list has been read. Aborting cannot close the
  extension's own prompt, so a Polkadot `connect()` started while it is open
  waits for that prompt instead of asking again.
- **No default timeout.** An extension prompt pends only while the user has
  not answered it, so kheopskit sets no timeout. Pass `AbortSignal.timeout(ms)`
  to cap the wait.
- **Settles with the state.** `connect()` resolves once `kheopskit$` has
  emitted a state in which the wallet has `isConnected: true`, so the state
  your UI reads already shows the connect. That costs one microtask after the
  platform's grant (1.9 ms wall clock, measured once during K3 in a
  fake-timer unit run). There are two exceptions. A `disconnect()` that
  completes while `connect()` waits for that state rejects it with `ABORTED`.
  When the wallet leaves the list (an extension removed) after the platform
  granted the connect, `connect()` resolves even if no state showed the wallet
  connected, and the wallet stays remembered. Removed before the grant, it
  rejects with `ABORTED`. A `disconnect()` whose platform call is still
  pending or refused does not count as completed, so the `connect()` still
  resolves once the state shows the wallet connected (today only Solana has a
  platform disconnect).
- **Disconnect.** `disconnect()` forgets the wallet first, then waits for the
  platform's disconnect, if the platform has one, and rejects when that call
  fails (the wallet is then remembered again and stays connected). It then
  resolves once `kheopskit$` has emitted the wallet with `isConnected: false`,
  or once a later `connect()`, the wallet leaving the list or the end of the
  subscription makes that emission impossible. A `disconnect()` that still
  waits for the platform settles when the platform answers, even after the
  subscription ended. During a pending `connect()` that the platform has not
  granted, `disconnect()` aborts it and resolves without waiting for the
  prompt.
- **After the subscription.** Once the last `kheopskit$` subscriber has
  unsubscribed, `connect()` and `disconnect()` on an injected wallet object
  from that subscription reject with `ABORTED` without asking the platform. A
  placeholder's `connect()` rejects the same way, and its `disconnect()` still
  resolves at once. The live WalletConnect connector is not wrapped, so its
  `connect()` still opens the AppKit modal and its `disconnect()` still ends a
  live session.

Every rejection of `connect()` is a `KheopskitError` with a stable `code` and
the `walletId`, and so is an `ABORTED` `disconnect()`. A `disconnect()` whose
platform call fails (Solana, the WalletConnect connector) rejects with the
platform's own error.

| Code | When |
|------|------|
| `USER_REJECTED` | The user refused the prompt. `cause` holds the platform error. |
| `CONNECT_FAILED` | Any other platform failure, including a Polkadot extension whose `enable()` result lacks `accounts.get`, `accounts.subscribe`, `signer.signPayload` or `signer.signRaw`, or whose `accounts.get()` rejects. `cause` holds the platform error. |
| `ABORTED` | The call was abandoned, as listed above. The message reads `connect of wallet <id> was aborted` or `disconnect of wallet <id> was aborted`. |
| `FEATURE_NOT_SUPPORTED` | A Solana Wallet Standard wallet that lacks `standard:connect`. |
| `WALLET_PENDING` | `connect()` on a placeholder whose live wallet was not discovered before hydration ended, and always on a `getHydratedSnapshot` placeholder. |

A Polkadot extension sends a plain `Error` on refusal, so kheopskit maps its
message: Talisman's `Site <url> has not been authorised for Talisman yet`
(observed live), polkadot.js's `Connection request was rejected by the user.`,
SubWallet's `Rejected` or `Cancelled`. On Ethereum, an EIP-1193 error with code
`4001` maps to `USER_REJECTED`. Branch on `error.code`, not on the message. A
rejected `accounts.get()` during a Polkadot connect whose message matches one
of these refusals also maps to `USER_REJECTED`. Refused live in Talisman, a
connect rejects with the message `[kheopskit] the user rejected the connect
request of wallet polkadot:talisman` and the Talisman error as `cause`.

The WalletConnect connector differs. Its `connect()` opens the AppKit modal
and resolves once it is open, `isConnected` follows when the user approves a
session, and `signal` is accepted for signature compatibility only.

#### Accounts

In `kheopskit$`, each wallet connection has its own account stream. It starts
empty when the wallet connects and ends when it disconnects. No emission shows a
disconnected wallet still listing live accounts, or a connected wallet listing
the accounts of a previous connection, and another wallet's pending request
(Ethereum `eth_accounts`) never delays a wallet's accounts. A Polkadot
wallet's `connect()` reads `accounts.get()` before it resolves, so the
emission that first shows it connected already lists its accounts. On
platforms that list accounts asynchronously (Ethereum `eth_accounts`), the
accounts may arrive in a later emission. While `isHydrating` is `true`, a
wallet's cached placeholder accounts stay listed, whatever its status, until
live accounts replace them or hydration ends. The guarantee has one more
exception. The first value of a platform plugin's `getAccounts$`, called
directly with wallets that are already connected, waits until each of them has
answered. `kheopskit$` subscribes before any wallet is connected, so it never
waits.

`state.accounts` is grouped by platform (Polkadot, Ethereum, Solana), then by
wallet (Talisman first, then by wallet name). Inside a wallet, accounts keep
the order the extension lists them in. `state.wallets` follows the same
platform order, then the WalletConnect connector, with Talisman first, then by
name.

Every account has an optional `name`. On Polkadot it is the account name the
extension lists. On Solana it is the Wallet Standard `label`, when the wallet
provides one. On Ethereum it is always `undefined`, because EIP-1193 and
EIP-6963 expose no account name. A wallet can report an empty name, so
`account.name || account.address` gives a display label on every platform. A
cached placeholder keeps the `name` of the account it stands for.

### Persistence

Source: [`api/store.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/api/store.ts),
[`api/compactStore.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/api/compactStore.ts),
[`utils/storage.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/utils/storage.ts).

The data lives under the key `kheopskit` (change it with the `storageKey`
config option, for example to run two dapps on one origin). In the browser it
goes to `localStorage` as JSON:

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

- `remembered` lists the injected wallets the user connected. It is written as
  soon as a connect succeeds and cleared as soon as `disconnect()` starts on a
  connected wallet. A `disconnect()` that aborts a pending connect leaves it
  unchanged.
- `cachedWallets` and `cachedAccounts` are written by the hydration rule above:
  after hydration ends, 1 second after the state stops changing.
- Wallet icons go to a separate `localStorage` key, `kheopskit-icons`, to keep
  the main entry small.

With `ssrCookies`, the same data goes to a `kheopskit` cookie in a compact
form, to stay under the cookie size limit:

```json
{ "v": 1, "r": ["polkadot:talisman"], "w": [["polkadot:talisman", "Talisman", 1, 0]], "a": [["polkadot:talisman", "5Grw…", "Alice", null, 0, 0]] }
```

`r` is `remembered`, `w` holds `[id, name, isConnected, type]` per wallet and
`a` holds `[walletId, address, name, chainId, polkadotType, platform]` per
account. The cookie is URI-encoded, lasts one year, and is set with `path=/`,
`SameSite=Lax`, and `Secure` on HTTPS. Kheopskit warns in the console when the
encoded value exceeds 3072 bytes.

Data written before v6 stored `remembered` as `autoReconnect`. The store reads
that field as `remembered` and drops it on the next write. A storage write that
throws (`QuotaExceededError`, a denied write) keeps the in-memory state while
the store is observed, and
neither `connect()` nor `disconnect()` rejects because of it.

#### Custom storage

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

`subscribe` is optional. Implement it to receive changes made by other tabs.
The store holds that subscription only while `store.observable` has
subscribers. `store.destroy()` completes `store.observable`, which ends it.
`store.rememberWallet(walletId)` and `store.forgetWallet(walletId)` edit the
remembered list directly.

### Signing

Source: [`api/polkadot/accounts.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/api/polkadot/accounts.ts),
[`api/polkadot/types.ts`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/api/polkadot/types.ts).

A live Polkadot account signs transactions through the signer polkadot-api
expects. The field follows the installed polkadot-api version, detected at
runtime. It is `txCreator` (a `TxCreator`) on v3 and later, and
`polkadotSigner` (a `PolkadotSigner`) on v2. With neither factory available,
kheopskit throws a `KheopskitError` with code `UNSUPPORTED_VERSION`. On v3 and
later, the `txCreator` of an account whose `type` is `ethereum` is built with
the `ecdsa` signature type, so fee estimation and dry runs use a 65-byte mock
signature. On v2, `getPolkadotSignerFromPjs` ignores the signature type.
Ethereum accounts expose `client` (viem), and Solana accounts `signer` and
`getSigner(chain)`.

`account.signRaw(data, options?)` signs arbitrary data with the wallet's raw
signing call (`signer.signRaw` for an extension, `polkadot_signMessage` over
WalletConnect) and resolves the hex signature:

- A string is sent as text with `type: "payload"`, and a `Uint8Array` as `0x`
  hex with `type: "bytes"`. An explicit `options.type` is sent as given for
  either input. Over WalletConnect, `polkadot_signMessage` has no `type`, so
  none is sent.
- A hex-looking string is sent as text, so pass a `Uint8Array` for bytes.
  Talisman, polkadot.js, SubWallet and Nova decode a `0x`-shaped string as
  bytes (Talisman observed live, the others read from their sources).
- Pass a string for a Sign-In With Substrate (SIWS) message. Talisman opens its
  Sign In screen when the text parses as SIWS and its generic Sign Request
  screen for anything else, hex included. The SIWS `Version` line must read
  `1.0.0`. Talisman rejects `1` and falls back to the generic screen. The
  screen follows `data`, not `type`.
- Talisman, polkadot.js, SubWallet and Nova ignore `type` (read from their
  sources). Enkrypt reads it as the encoding of `data`, so it needs the value
  the derived default sends.

What Talisman 3.11.0 showed for one SIWS message (`Version: 1.0.0`), observed
live:

| Call | `data` sent | `type` sent | Screen |
|------|-------------|-------------|--------|
| `signRaw(message)` | text | `"payload"` | Sign In ("wants you to sign in with Substrate") |
| `signRaw(message, { type: "bytes" })` | text | `"bytes"` | Sign In |
| `signRaw(bytes)` with a `Uint8Array` | hex | `"bytes"` | Sign Request |
| `txCreator.signBytes(bytes)` | hex | `"bytes"` | Sign Request |
| `signRaw` of the same text with `Version: 1` | text | either | Sign Request |

Every signature taken verified. An `ethereum` account signs a 65-byte
signature that recovers to its address over keccak256 of the `<Bytes>`-wrapped
message.

On a connected Polkadot wallet, `wallet.extension` is the raw object
`enable(appName)` returned, typed `PolkadotInjected`. Use it for extension calls
kheopskit does not wrap. It is `undefined` until the wallet is connected, so
also while it connects, and a placeholder has none. Talisman adds `readonly`
and `partOfPortfolio` to the accounts it shares with its own origins. Both are
typed on `PolkadotAccount`.

### Testing

Source: [`testing/`](https://github.com/kheopskit/kheopskit/blob/main/packages/core/src/testing).

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
  `FAKE_SIGNATURE`. `signRawCalls()` lists what `signRaw` received;
  `signPayload` calls are not recorded.
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
the discovery reads, the hydration timers and the 1 second persistence
debounce. Without it, a persist can write to storage after the test ended.
`store.destroy()` ends the store's storage subscription. `uninstall()` removes
the fake from `window.injectedWeb3`, and removes `window.injectedWeb3` once it
is empty.

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

The kit fakes Polkadot extensions only. It has no hook to make `disconnect()`
fail.

### Design choices

- Kheopskit stops reading the Polkadot registry when the read window ends, and
  has no `refreshWallets()`. Wallets inject at page load, and a permanent
  watcher would add timers and states for a case no supported wallet produces.
- No `walletsReady` promise. It would be a second surface for the one fact
  `isDiscovering` carries.
- The read window restarts at `load` instead of running a longer poll from
  subscribe. Its coverage after `load` then no longer depends on when the app
  subscribes.
- Discovery ends 1100 ms after `load`, not at `load`, so a wallet that injects
  shortly after `load` is listed before `isDiscovering` turns `false`.
  Hydration waits for that end only while a cached wallet is missing.
- `remembered` is read once at subscribe. A live read would make a connect in
  one tab connect every open tab, with no matching disconnect.
- No `persist: false` option. The `autoReconnect` predicate covers "do not
  reconnect", and `storageKey` keeps two dapps apart.

## License

ISC
