# kheopskit

## 4.0.0

### Major Changes

- [`e431cf5`](https://github.com/kheopskit/kheopskit/commit/e431cf5264de6b91dbecd53472d010717f1fab5a) Thanks [@0xKheops](https://github.com/0xKheops)! - Version unification: @kheopskit/core, @kheopskit/react and the repository release tag now share a single version number, starting at 4.0.0, and will stay in lockstep going forward.

  The version-alignment bump on its own introduces no API changes; this release also ships the Solana + plugin-architecture work (see the accompanying changeset), which **is** breaking. Consumers must update their ranges when upgrading: `@kheopskit/core` `^1.x` → `^4.0.0`, `@kheopskit/react` `^3.x` → `^4.0.0`.

- [#53](https://github.com/kheopskit/kheopskit/pull/53) [`4971fdc`](https://github.com/kheopskit/kheopskit/commit/4971fdc7c453ea93f0a559c5a7fca92408193ed6) Thanks [@0xKheops](https://github.com/0xKheops)! - Add Solana support and move to a plugin / subpath-exports architecture so dapps install only the SDKs for the platforms they use.

  **New: Solana** — injected wallets via the Wallet Standard, WalletConnect via Reown AppKit. Solana accounts expose `@solana/kit` signer interfaces (`signer` / `getSigner(chain)`).

  **Breaking: platforms are now plugins.** Each platform lives behind its own entry point and brings its own optional peer dependencies. A Polkadot-only dapp never pulls Ethereum/Solana code or their SDKs (`viem`, `@solana/kit`, `mipd`, `@wallet-standard/*`) into its bundle or type-check.

  Migration:

  ```diff
  - import { getKheopskit$ } from "@kheopskit/core";
  + import { getKheopskit$ } from "@kheopskit/core";
  + import { polkadot } from "@kheopskit/core/polkadot";
  + import { solana } from "@kheopskit/core/solana";

    getKheopskit$({
  -   platforms: ["polkadot", "solana"],
  -   polkadotAccountTypes: ["sr25519"],
  -   solanaChain: "solana:devnet",
  +   platforms: [
  +     polkadot({ accountTypes: ["sr25519"] }),
  +     solana({ chain: "solana:devnet" }),
  +   ],
    });
  ```

  - `config.platforms` takes plugin objects (from `@kheopskit/core/<platform>`), and is required (no default).
  - `polkadotAccountTypes` and `solanaChain` move into `polkadot({ accountTypes })` and `solana({ chain })`.
  - Platform types (`PolkadotAccount`, `EthereumAccount`, `SolanaAccount`, `WalletAccount`, …) are exported from the platform entry points, not the package root.
  - `viem` is now an (optional) peer dependency instead of a bundled dependency; `mipd` and `@wallet-standard/*` likewise. Install the SDKs for the platforms you use (see README).
  - React: `useWallets()` returns the SDK-free base shapes; call `useWallets<typeof platforms>()` to recover platform-precise account/wallet types (React contexts cannot be generic).

  Address validation in core is unchanged — it now uses `@scure/base` + `@noble/hashes` directly instead of the platform SDKs.

- [#53](https://github.com/kheopskit/kheopskit/pull/53) [`4971fdc`](https://github.com/kheopskit/kheopskit/commit/4971fdc7c453ea93f0a559c5a7fca92408193ed6) Thanks [@0xKheops](https://github.com/0xKheops)! - v4 API ergonomics and breaking-change cleanup (landed alongside the Solana / plugin work).

  **Breaking**

  - `wallet.disconnect()` now returns `Promise<void>` (was `() => void`). It awaits the underlying provider/extension disconnect and rejects on failure, so disconnect errors are no longer silently swallowed. Fire-and-forget call sites keep working.
  - Injected wallet identifier fields are unified to `wallet.sourceId` (was `providerId` on Ethereum, `walletStandardId` on Solana, `extensionId` on Polkadot). The value is unchanged per platform.
  - Wallet operations throw a typed `KheopskitError` (with a stable `.code`: `WALLET_ALREADY_CONNECTED`, `WALLET_NOT_CONNECTED`, `FEATURE_NOT_SUPPORTED`, `NO_SESSION`, `NO_PROVIDER`) instead of an ad-hoc `Error`.
  - `account.walletId` is now branded `WalletId` (was `string`).
  - Internal hydration/cache plumbing (`hydrateAccount`, `hydrateWallet`, `getCachedIcon`, `acceptsCachedAccount`, `clearCachedObservable`, …) moved from the package root to `@kheopskit/core/internal` and is no longer part of the semver-stable public API.

  **Added**

  - `createKheopskit({ platforms })` (`@kheopskit/react`) returns a `KheopskitProvider` plus `useWallets` / `useAccounts` hooks already typed to your platform tuple — no more repeating `useWallets<typeof platforms>()`. A standalone `useAccounts` hook is also exported.
  - New public exports from `@kheopskit/core`: `WalletId`, `getWalletId`, `parseWalletId`, `WalletAccountId`, `getWalletAccountId`, `KheopskitError`, `KheopskitErrorCode`, `isValidAddress`. Per-platform address validators are exported from the platform entries: `isEthereumAddress` (`/ethereum`), `isSs58Address` (`/polkadot`), `isSolanaAddress` (`/solana`).
  - The three `*AppKitWallet` types are now aliases of a single generic `AppKitWallet<P>`.

  **Fixed**

  - WalletConnect (AppKit) wallets now clear their cached account observables on `disconnect`, so a later reconnect rebuilds against the fresh session instead of a stale provider closure (previously only injected wallets did this). The Ethereum AppKit account cache is keyed per wallet id instead of a shared static key.
  - Solana AppKit accounts now report the clusters the WalletConnect session actually advertises (falling back to the configured chain).
  - `KheopskitState` change-detection now also reacts to Solana `chains` and Polkadot key-type changes (previously only Ethereum `chainId`).

### Patch Changes

- [`875a5da`](https://github.com/kheopskit/kheopskit/commit/875a5da787785d7d73e9beb3b4011f45098ff126) Thanks [@0xKheops](https://github.com/0xKheops)! - Fix WalletConnect accounts not appearing for Substrate. Reown AppKit never populates `getAccount("polkadot").allAccounts` (the polkadot namespace has no native AppKit adapter), so connected sessions reported zero accounts and no signer was available. Polkadot accounts are now derived from the WalletConnect session namespaces (CAIP-10 entries, deduplicated across chains), which is the authoritative source and works on all AppKit 1.8.x versions.

- Updated dependencies [[`e431cf5`](https://github.com/kheopskit/kheopskit/commit/e431cf5264de6b91dbecd53472d010717f1fab5a), [`4971fdc`](https://github.com/kheopskit/kheopskit/commit/4971fdc7c453ea93f0a559c5a7fca92408193ed6), [`4971fdc`](https://github.com/kheopskit/kheopskit/commit/4971fdc7c453ea93f0a559c5a7fca92408193ed6), [`875a5da`](https://github.com/kheopskit/kheopskit/commit/875a5da787785d7d73e9beb3b4011f45098ff126)]:
  - @kheopskit/core@4.0.0
  - @kheopskit/react@4.0.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`6f42b72`](https://github.com/kheopskit/kheopskit/commit/6f42b72b2335acd7053b1811f5aa69eed28768f6)]:
  - @kheopskit/react@3.0.0
  - @kheopskit/core@1.0.0

## 0.2.0

### Minor Changes

- [#35](https://github.com/kheopskit/kheopskit/pull/35) [`728c5e5`](https://github.com/kheopskit/kheopskit/commit/728c5e5dd09af5614a12667bdafaa189a4fe4ac7) Thanks [@0xKheops](https://github.com/0xKheops)! - polkadot account type filter

### Patch Changes

- Updated dependencies [[`728c5e5`](https://github.com/kheopskit/kheopskit/commit/728c5e5dd09af5614a12667bdafaa189a4fe4ac7)]:
  - @kheopskit/core@0.2.0
  - @kheopskit/react@2.0.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`6fb777a`](https://github.com/kheopskit/kheopskit/commit/6fb777ad9605465050a2e477084c6be7426c4abf)]:
  - @kheopskit/core@0.1.2
  - @kheopskit/react@1.0.1

## 0.1.1

### Patch Changes

- Updated dependencies [[`bd76383`](https://github.com/kheopskit/kheopskit/commit/bd763833afea4443923fe7f9592471ab73af676d)]:
  - @kheopskit/core@0.1.1
  - @kheopskit/react@1.0.1

## 0.1.0

### Minor Changes

- [#29](https://github.com/kheopskit/kheopskit/pull/29) [`27518cf`](https://github.com/kheopskit/kheopskit/commit/27518cf85af04fcc617365193fe885a4f9184fcd) Thanks [@0xKheops](https://github.com/0xKheops)! - feat: SSR support with cookie-based storage and storageKey namespace option

### Patch Changes

- Updated dependencies [[`27518cf`](https://github.com/kheopskit/kheopskit/commit/27518cf85af04fcc617365193fe885a4f9184fcd)]:
  - @kheopskit/react@1.0.0
  - @kheopskit/core@0.1.0

## 0.0.27

### Patch Changes

- [#27](https://github.com/kheopskit/kheopskit/pull/27) [`db07cec`](https://github.com/kheopskit/kheopskit/commit/db07cec441b9c7ddb8fdc1e0efdedfcb83246b2f) Thanks [@0xKheops](https://github.com/0xKheops)! - bump dependencies and improve performance

## 0.0.26

### Patch Changes

- Updated dependencies [[`b3d5f98`](https://github.com/kheopskit/kheopskit/commit/b3d5f989a33f9c13f56833f71494df5091c4930c), [`cd73eb1`](https://github.com/kheopskit/kheopskit/commit/cd73eb18840a69b49238629051450eca26b9e275)]:
  - @kheopskit/core@0.0.21
  - @kheopskit/react@0.0.25

## 0.0.25

### Patch Changes

- Updated dependencies [[`920ed5b`](https://github.com/kheopskit/kheopskit/commit/920ed5babefc6d38ddc18bde3d68ff945cd1a0af)]:
  - @kheopskit/react@0.0.24

## 0.0.24

### Patch Changes

- [`87bbfb0`](https://github.com/kheopskit/kheopskit/commit/87bbfb016b15bd0378a62943ccbe1403a6e5d07e) Thanks [@0xKheops](https://github.com/0xKheops)! - test: changeset2

- [`87bbfb0`](https://github.com/kheopskit/kheopskit/commit/87bbfb016b15bd0378a62943ccbe1403a6e5d07e) Thanks [@0xKheops](https://github.com/0xKheops)! - test: changeset

- Updated dependencies [[`87bbfb0`](https://github.com/kheopskit/kheopskit/commit/87bbfb016b15bd0378a62943ccbe1403a6e5d07e)]:
  - @kheopskit/core@0.0.20
  - @kheopskit/react@0.0.23

## 0.0.23

### Patch Changes

- [`e68aaa5`](https://github.com/kheopskit/kheopskit/commit/e68aaa5019630b03660d1cb5e95a9188cf972ebf) Thanks [@0xKheops](https://github.com/0xKheops)! - test: changeset

- Updated dependencies [[`e68aaa5`](https://github.com/kheopskit/kheopskit/commit/e68aaa5019630b03660d1cb5e95a9188cf972ebf)]:
  - @kheopskit/core@0.0.19
  - @kheopskit/react@0.0.22

## 0.0.22

### Patch Changes

- Updated dependencies [[`a35e7f9`](https://github.com/kheopskit/kheopskit/commit/a35e7f9808bd215088dbfb7747d217622e429618)]:
  - @kheopskit/react@0.0.21

## 0.0.21

### Patch Changes

- [`fa9a13e`](https://github.com/kheopskit/kheopskit/commit/fa9a13edfc5dbee8a4093dd2079929880049ed23) Thanks [@0xKheops](https://github.com/0xKheops)! - feat: root changeset
