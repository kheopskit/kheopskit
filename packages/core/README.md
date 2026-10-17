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
code. Concurrent `connect()` calls share one pending promise, a repeat call on
a wallet that is already connected (or disconnected) resolves at once, and
`connect({ signal })` rejects with a `KheopskitError` of code `ABORTED` when
the signal fires. A refused prompt rejects with `USER_REJECTED` and any other
failure with `CONNECT_FAILED`; both carry the platform error as `cause`. Each
promise resolves only after `kheopskit$` has emitted the wallet's new
`isConnected` value, and there is no default timeout: pass
`AbortSignal.timeout(ms)` to cap the wait.

`state.isDiscovering` is `true` until the page has fired `load` and kheopskit
has read `window.injectedWeb3` again, so the emission that turns it `false`
already lists every Polkadot extension injected by then. Wait for it before you
conclude that a wallet is missing. It is `false` from the first emission when you
subscribe after `load`, and always `true` on the server. It says nothing about
wallets that inject after `load`.

## License

ISC
