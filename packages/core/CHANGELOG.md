# @kheopskit/core

## 5.0.0

### Major Changes

- WalletConnect is now a single, platform-less connector instead of one wallet per platform.

  A WalletConnect session is shared across every namespace and is established in a single pairing, so `wallets` now contains exactly one `WalletConnectWallet` (`type: "walletconnect"`, no `platform`) with a `platforms: WalletPlatform[]` array of the namespaces the live session actually approved. Its accounts still appear in `accounts`, each carrying its own `platform`.

  This fixes the previous behaviour where each platform showed its own "WalletConnect" connect button — only the first did anything, and disconnecting one tore down the whole session.

  BREAKING CHANGES:

  - Removed `AppKitWallet`, `PolkadotAppKitWallet`, `EthereumAppKitWallet`, `SolanaAppKitWallet`. Use `WalletConnectWallet` together with the `isWalletConnectWallet(wallet)` type guard (exported from `@kheopskit/core` and from each platform entry point).
  - `WalletType` is now `"injected" | "walletconnect"` (`"appKit"` removed).
  - The WalletConnect entry has no `platform` field — narrow with `isWalletConnectWallet(wallet)` before reading `wallet.platform`. Per-platform wallet filters (`wallets.filter(w => w.platform === "polkadot")`) no longer match it; find it with `wallets.find(isWalletConnectWallet)`.
  - Connect/disconnect are session-wide: connecting opens one modal and the wallet approves whichever namespaces it supports; a namespace cannot be added to a live session (disconnect and re-pair to change the approved set).

### Patch Changes

- [`ef02b3a`](https://github.com/kheopskit/kheopskit/commit/ef02b3ade87c04c1732e746f4490b70b94b85451) Thanks [@0xKheops](https://github.com/0xKheops)! - fix: wallet connect ethereum

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

## 1.0.1

### Patch Changes

- [`9197b88`](https://github.com/kheopskit/kheopskit/commit/9197b88b2a2e971fab1bf8ce0f0f5a685a6dd2d9) Thanks [@0xKheops](https://github.com/0xKheops)! - Update dependency ranges to latest versions: viem ^2.52.2, @reown/appkit ^1.8.20, polkadot-api ^2.1.6. No API changes.

## 1.0.0

### Major Changes

- [#45](https://github.com/kheopskit/kheopskit/pull/45) [`6f42b72`](https://github.com/kheopskit/kheopskit/commit/6f42b72b2335acd7053b1811f5aa69eed28768f6) Thanks [@0xKheops](https://github.com/0xKheops)! - update to papi v2

  BREAKING CHANGE: polkadot-api v1 is no longer supported. Consumers must upgrade to polkadot-api >= 2.0.0.

## 0.2.0

### Minor Changes

- [#35](https://github.com/kheopskit/kheopskit/pull/35) [`728c5e5`](https://github.com/kheopskit/kheopskit/commit/728c5e5dd09af5614a12667bdafaa189a4fe4ac7) Thanks [@0xKheops](https://github.com/0xKheops)! - polkadot account type filter

## 0.1.2

### Patch Changes

- [#33](https://github.com/kheopskit/kheopskit/pull/33) [`6fb777a`](https://github.com/kheopskit/kheopskit/commit/6fb777ad9605465050a2e477084c6be7426c4abf) Thanks [@0xKheops](https://github.com/0xKheops)! - chainId property on ethereum wallets

## 0.1.1

### Patch Changes

- [#31](https://github.com/kheopskit/kheopskit/pull/31) [`bd76383`](https://github.com/kheopskit/kheopskit/commit/bd763833afea4443923fe7f9592471ab73af676d) Thanks [@0xKheops](https://github.com/0xKheops)! - fix: SSR compatibility with edge runtimes like Cloudflare Workers

  - Lazy initialize `safeLocalStorage` to avoid accessing browser globals at module load
  - Lazy initialize default store via `getDefaultStore()` for SSR safety
  - Dynamically import `@reown/appkit/core` to prevent Lit (browser-only) code from loading on server
  - Add SSR safety tests to prevent regressions
  - Export `getDefaultStore` and `getSafeLocalStorage` for advanced use cases

## 0.1.0

### Minor Changes

- [#29](https://github.com/kheopskit/kheopskit/pull/29) [`27518cf`](https://github.com/kheopskit/kheopskit/commit/27518cf85af04fcc617365193fe885a4f9184fcd) Thanks [@0xKheops](https://github.com/0xKheops)! - feat: SSR support with cookie-based storage and storageKey namespace option

## 0.0.22

### Patch Changes

- [#27](https://github.com/kheopskit/kheopskit/pull/27) [`db07cec`](https://github.com/kheopskit/kheopskit/commit/db07cec441b9c7ddb8fdc1e0efdedfcb83246b2f) Thanks [@0xKheops](https://github.com/0xKheops)! - bump dependencies and improve performance

## 0.0.21

### Patch Changes

- [`b3d5f98`](https://github.com/kheopskit/kheopskit/commit/b3d5f989a33f9c13f56833f71494df5091c4930c) Thanks [@0xKheops](https://github.com/0xKheops)! - feat: theme variables

- [`cd73eb1`](https://github.com/kheopskit/kheopskit/commit/cd73eb18840a69b49238629051450eca26b9e275) Thanks [@0xKheops](https://github.com/0xKheops)! - fix: hide all wallets

## 0.0.20

### Patch Changes

- [`87bbfb0`](https://github.com/kheopskit/kheopskit/commit/87bbfb016b15bd0378a62943ccbe1403a6e5d07e) Thanks [@0xKheops](https://github.com/0xKheops)! - test: changeset2

## 0.0.19

### Patch Changes

- [`e68aaa5`](https://github.com/kheopskit/kheopskit/commit/e68aaa5019630b03660d1cb5e95a9188cf972ebf) Thanks [@0xKheops](https://github.com/0xKheops)! - test: changeset

## 0.0.18

### Patch Changes

- [`2e04a98`](https://github.com/kheopskit/kheopskit/commit/2e04a9893795e6aa43c942dee61443b4700c3294) Thanks [@0xKheops](https://github.com/0xKheops)! - fix: sync changesets

## 0.0.15

### Patch Changes

- [`a540c06`](https://github.com/kheopskit/kheopskit/commit/a540c06e90816656a1a21df3d95d0328bff78455) Thanks [@0xKheops](https://github.com/0xKheops)! - test: one more changeset

## 0.0.14

### Patch Changes

- [`b8242ab`](https://github.com/kheopskit/kheopskit/commit/b8242abd31a6512b16399dd44ca5e5d82f6c70bf) Thanks [@0xKheops](https://github.com/0xKheops)! - test: changeset

## 0.0.13

### Patch Changes

- [`5e07091`](https://github.com/kheopskit/kheopskit/commit/5e070910229cb9202f5d2f1869bfb16c5180d273) Thanks [@0xKheops](https://github.com/0xKheops)! - test: changeset

## 0.0.12

### Patch Changes

- [`2f34f0c`](https://github.com/kheopskit/kheopskit/commit/2f34f0c16c7866a4187b4474a45f93e2ad07f5c7) Thanks [@0xKheops](https://github.com/0xKheops)! - test: changeset

## 0.0.11

### Patch Changes

- [`9d4f86e`](https://github.com/kheopskit/kheopskit/commit/9d4f86e7632843fad089ce930b209aee9b9e2b41) Thanks [@0xKheops](https://github.com/0xKheops)! - test changeset

## 0.0.10

### Patch Changes

- [`c7dea32`](https://github.com/kheopskit/kheopskit/commit/c7dea32e2921716cef82b53e1960c3cdb4c8e5ae) Thanks [@0xKheops](https://github.com/0xKheops)! - test changeset

## 0.0.9

### Patch Changes

- [`961f6a3`](https://github.com/kheopskit/kheopskit/commit/961f6a371c73d4065e9157c95ca4d996012098e7) Thanks [@0xKheops](https://github.com/0xKheops)! - test changeset

## 0.0.8

### Patch Changes

- [`b76185f`](https://github.com/kheopskit/kheopskit/commit/b76185f99a78c5a82a8b9aead65b0708f17b0bd5) Thanks [@0xKheops](https://github.com/0xKheops)! - test changeset

## 0.0.7

### Patch Changes

- [`07f8406`](https://github.com/kheopskit/kheopskit/commit/07f8406d3f176e6a8b3b06fe16396bf2b6b1db88) Thanks [@0xKheops](https://github.com/0xKheops)! - test changeset

## 0.0.6

### Patch Changes

- [`5319326`](https://github.com/kheopskit/kheopskit/commit/53193262e80fec9e242986f818d7f7b53f92357a) Thanks [@0xKheops](https://github.com/0xKheops)! - test changeset

## 0.0.5

### Patch Changes

- [`d865842`](https://github.com/kheopskit/kheopskit/commit/d86584236e51730e82baaa9068604fa7e703e9c2) Thanks [@0xKheops](https://github.com/0xKheops)! - test changeset

## 0.0.4

### Patch Changes

- [`4a61939`](https://github.com/kheopskit/kheopskit/commit/4a61939b9a5c4ea6fb119a0427704a5fc684343e) Thanks [@0xKheops](https://github.com/0xKheops)! - test changeset

## 0.0.3

### Patch Changes

- [`7a0ea89`](https://github.com/kheopskit/kheopskit/commit/7a0ea890982570ae89934fead69d319fff46dd98) Thanks [@0xKheops](https://github.com/0xKheops)! - test changeset

## 0.0.2

### Patch Changes

- [`806b8d3`](https://github.com/kheopskit/kheopskit/commit/806b8d394ba7c2576c76d9de72a15d7927bcff9e) - update peer deps

## 0.0.1

### Patch Changes

- [`e1cebed`](https://github.com/kheopskit/kheopskit/commit/e1cebed92d303f041070e0ae146ee34d9eb717bd) - refactor property names

- [`e1cebed`](https://github.com/kheopskit/kheopskit/commit/e1cebed92d303f041070e0ae146ee34d9eb717bd) - initial alpha release

## 0.0.1-alpha.1

### Patch Changes

- [`4f378f9`](https://github.com/0xKheops/kheopskit-alpha/commit/4f378f9b61e555b7b66ef3bfaf107ab8e6ac62b1) - refactor property names

## 0.0.1-alpha.0

### Patch Changes

- [`3216d3b`](https://github.com/0xKheops/kheopskit-alpha/commit/3216d3b4ca1f2fadbebe9a4275e7b864ac89d222) - initial alpha release
