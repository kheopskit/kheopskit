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
emitted the wallet with `isConnected: true`. `disconnect()` resolves once it has
emitted `isConnected: false`, or once a later `connect()` or the end of the
subscription makes that emission impossible. There is no default timeout: pass
`AbortSignal.timeout(ms)` to cap the wait for the platform's answer.

`state.isDiscovering` is `true` until the page has fired `load` and kheopskit
has read `window.injectedWeb3` again, so the emission that turns it `false`
already lists every Polkadot extension injected by then. Wait for it before you
conclude that a wallet is missing. It is `false` from the first emission when you
subscribe after `load`, and always `true` on the server. It says nothing about
wallets that inject after `load`.

## License

ISC
