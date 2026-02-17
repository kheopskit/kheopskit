# @kheopskit/core

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
