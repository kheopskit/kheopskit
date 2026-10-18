# kheopskit

## 6.0.0-rc.0

### Major Changes

- [#135](https://github.com/kheopskit/kheopskit/pull/135) [`3afa342`](https://github.com/kheopskit/kheopskit/commit/3afa34256a14c67dfa6302743716153a511a5c4b) Thanks [@0xKheops](https://github.com/0xKheops)! - `connect()` and `disconnect()` are safe to call from UI code.
  
  - Removed error codes `WALLET_ALREADY_CONNECTED` and `WALLET_NOT_CONNECTED`: `connect()` on a connected wallet and `disconnect()` on a disconnected wallet resolve at once.
  - New error codes `ABORTED`, `USER_REJECTED` and `CONNECT_FAILED`. A platform's connect rejection is wrapped in a `KheopskitError` carrying `cause` and `walletId`.
  - Concurrent `connect()` calls on one wallet share a single platform attempt; the platform is asked once. Each call gets its own promise.
  - `connect(options?: { signal?: AbortSignal })`: an abort before the platform answers rejects that caller with `ABORTED` and leaves the other callers waiting. An abort after the platform granted the connect changes nothing, and a Polkadot extension counts as granted only once its account list has been read. Once no caller waits, kheopskit drops a late handle without revoking the platform's grant, and the wallet is neither connected nor remembered. No default timeout.
  - `disconnect()` during a `connect()` the platform has not granted aborts it and never waits for the extension prompt. A `disconnect()` that completes while a granted `connect()` still waits for the state rejects that connect `ABORTED`; if the platform's disconnect is still pending or refuses, the connect resolves once the state shows the wallet connected (today only Solana has a platform disconnect). A waiting `disconnect()` is resolved by a `connect()`.
  - `connect()` resolves once `kheopskit$` has emitted the wallet with `isConnected: true`, or once the wallet has left the list after the platform granted it. `disconnect()` resolves, after the platform has answered its disconnect, once `kheopskit$` has emitted `isConnected: false`, or once a later `connect()`, the wallet leaving the list or the end of the subscription makes that emission impossible. After the last subscriber has unsubscribed, `connect()` and `disconnect()` on an injected wallet from that subscription reject `ABORTED` without asking the platform or changing the remembered list. A placeholder's `connect()` rejects the same way and its `disconnect()` resolves; the WalletConnect connector is not wrapped and still calls AppKit.
  - `disconnect()` forgets the wallet before asking the platform and remembers it again if the platform refuses. A `connect()` queued behind a pending `disconnect()` rejects `ABORTED` as soon as its `signal` fires or the last subscriber unsubscribes.
  - Persistence is best-effort: a storage write that throws keeps the in-memory state while the store is observed and never rejects `connect()` or `disconnect()`.
  - Wallet objects keep their identity across emissions that only change accounts.
  - `kheopskit$` no longer throttles by 16 ms. A synchronous burst is coalesced into one emission, so no emission shows a disconnected wallet still listing live accounts (cached placeholder accounts stay listed during hydration). On platforms that list accounts asynchronously (Ethereum `eth_accounts`) the accounts may arrive in an emission after `connect()` resolved.
  - A `connect()` whose wallet disappears before the platform grants it (extension removed, Wallet Standard unregister) rejects `ABORTED`; granted first, it resolves and the wallet stays remembered. A `disconnect()` waiting for the state resolves; one still waiting for the platform settles when the platform answers.
  - Fixed: with two connected wallets, disconnecting one no longer leaves its accounts in the state while the other wallet's accounts are being re-read.

- [#141](https://github.com/kheopskit/kheopskit/pull/141) [`d8198d3`](https://github.com/kheopskit/kheopskit/commit/d8198d3af41a21dd81d8294a731684ea46427a33) Thanks [@0xKheops](https://github.com/0xKheops)! - Placeholders restored from the cache carry `isPlaceholder: true`, and each platform account and wallet type is a union on it.
  
  - Reading `account.txCreator` (or `polkadotSigner`), `account.signRaw`, `account.client`, `account.signer`, `account.getSigner`, `wallet.provider`, `wallet.wallet` or the WalletConnect wallet's `appKit` without narrowing on `isPlaceholder` yields a possibly-`undefined` value, so calling it or using it as present fails to compile, and `wallet.sourceId` becomes `string | undefined`.
  - A placeholder wallet's `connect()` waits for the live wallet and connects it, rejecting `WALLET_PENDING` if hydration ends first and `ABORTED` if its signal fires or the subscription ends. Its `disconnect()` resolves at once. `PendingWalletError` is removed.
  - A cached wallet present in the live registry is not a placeholder and carries its live `connect()` and `disconnect()`. A Polkadot wallet's `extension` stays `undefined` until its reconnect succeeds.

- [#138](https://github.com/kheopskit/kheopskit/pull/138) [`4a3c02a`](https://github.com/kheopskit/kheopskit/commit/4a3c02af5009ffe01170548d33a55a9dc4b6366c) Thanks [@0xKheops](https://github.com/0xKheops)! - Polkadot raw signing and the injected handle:
  
  - `account.signRaw(data, options?)` signs a string as text or a `Uint8Array` as hex with the wallet's raw signing call (`signer.signRaw` for an extension, `polkadot_signMessage` over WalletConnect) and resolves the hex signature. With no `options.type`, a string is sent with `type: "payload"` and a `Uint8Array` with `type: "bytes"`; an explicit `options.type` is sent as given, except over WalletConnect, which sends no `type`. A hex-looking string is sent as text; pass a `Uint8Array` for bytes. Talisman's Sign In screen follows text `data`; Enkrypt reads `type` as the encoding of `data` and so needs the matching value.
  - `wallet.extension` is the raw object `enable()` returned, typed as `PolkadotInjected`, instead of pjs-signer's `InjectedExtension`. kheopskit calls `enable()` itself.
  - `ethereum` accounts get their `txCreator` built with the `ecdsa` signature type, so fee estimation and dry runs use a 65-byte mock signature. polkadot-api v2's `getPolkadotSignerFromPjs` ignores the signature type, so this change does not reach `polkadotSigner`.
  - The extension's account subscription is released on disconnect and when the last subscriber leaves.
  - Accounts the extension lists without a `type` are now kept as `sr25519`; `polkadot({ accountTypes })` is the only type filter.
  - `connect()` rejects `CONNECT_FAILED` (with an `Error` naming the extension as `cause`) when the `enable()` result lacks `accounts.get`, `accounts.subscribe`, `signer.signPayload` or `signer.signRaw`, or when `accounts.get()` rejects (a rejection whose message matches a known refusal maps to `USER_REJECTED`), and an account kheopskit cannot build is skipped instead of stalling the wallet's list.
  - `readonly` and `partOfPortfolio`, which Talisman adds for its own dapp origins, are typed as optional booleans on `PolkadotAccount`.

- [#137](https://github.com/kheopskit/kheopskit/pull/137) [`13c1bba`](https://github.com/kheopskit/kheopskit/commit/13c1bba70200012f8b63e65f998b9e9d88b6d1c4) Thanks [@0xKheops](https://github.com/0xKheops)! - Rename the persisted `autoReconnect` list to `remembered` (read-migrated) and the store methods to `rememberWallet`/`forgetWallet`; add a `storage` option and `destroy()` to `createKheopskitStore`; re-emit renamed accounts; keep each wallet's accounts in extension order. The store holds its cross-tab sync only while `store.observable` is observed. See MIGRATING_TO_V6.md.

- [#140](https://github.com/kheopskit/kheopskit/pull/140) [`0b5d0c1`](https://github.com/kheopskit/kheopskit/commit/0b5d0c1c81da88a08b9284b5c14d2b6e69b2ceeb) Thanks [@0xKheops](https://github.com/0xKheops)! - Every wallet carries a `status` and its last connect `error`, and `autoReconnect` takes a predicate.
  
  - `BaseWallet.status` is `"disconnected" | "connecting" | "connected"`; `isConnected` is `status === "connected"`. `connecting` covers a `connect()` call and an auto-reconnect alike. `BaseWallet.error` holds the last `USER_REJECTED` or `CONNECT_FAILED`, or `FEATURE_NOT_SUPPORTED` for a Wallet Standard wallet without `standard:connect`, and is cleared when the next attempt starts. The WalletConnect connector carries the same fields.
  - `autoReconnect: boolean | ((wallet: BaseWallet) => boolean)` governs injected wallets. The function must be synchronous and pure; it decides per remembered injected wallet. Every successful connect is still remembered, whatever this option says. The WalletConnect row follows AppKit's own session restore and hydrates `connecting` while AppKit restores.
  - A reconnect the user refuses forgets the wallet, so the next load does not prompt again. Other failures set `error`, keep the wallet remembered and are retried on later changes to the wallet list, 3 attempts in total. A manual `connect()` or `disconnect()` on a remembered wallet ends its automatic reconnect for the session. A `disconnect()` while the automatic reconnect still waits for the extension aborts it without forgetting the wallet, so the next load reconnects it. Automatic reconnect also ends when the wallet disappears mid-attempt; the wallet stays remembered for the next load. Nothing is written to `console.error`.
  - On a reload, a cached connected wallet shows `status: "connecting"` with `isConnected: false` from the first frame until its reconnect settles; one the predicate rejects shows `disconnected` without its cached accounts. No emission shows `isConnected: true` with a status other than `connected`.
  - `getHydratedSnapshot(store, config, options)` takes the resolved config (`platforms` and `autoReconnect`) in place of the platforms array.

- [#142](https://github.com/kheopskit/kheopskit/pull/142) [`6365290`](https://github.com/kheopskit/kheopskit/commit/63652909861336ea19986dd141102a00be524808) Thanks [@0xKheops](https://github.com/0xKheops)! - WalletConnect is a plugin from the new `@kheopskit/core/walletconnect` entry. A dapp that does not import it bundles none of kheopskit's AppKit code and no AppKit chunks.
  
  - `config.walletConnect` takes `walletConnect({ projectId, metadata, networks })`. A raw options object is a type error, and `getKheopskit$` throws a `KheopskitError` with the new code `INVALID_CONFIG`.
  - `resetAppKitCache` moved to `@kheopskit/core/walletconnect`.
  - `WalletConnectConfig` is now `WalletConnectOptions`, exported from `@kheopskit/core/walletconnect`. The unused `relayUrl` option is removed.

### Minor Changes

- [#139](https://github.com/kheopskit/kheopskit/pull/139) [`28ef218`](https://github.com/kheopskit/kheopskit/commit/28ef21809d1219bc80ff385faf3625447fabbdb9) Thanks [@0xKheops](https://github.com/0xKheops)! - Add `@kheopskit/core/testing`: `createFakePolkadotExtension`, `createMemoryStorage`, `cachedWalletOf` and `cachedAccountOf`, to run kheopskit in tests without a browser extension.

- [#134](https://github.com/kheopskit/kheopskit/pull/134) [`c04ead2`](https://github.com/kheopskit/kheopskit/commit/c04ead23cfa2b4ba0f7431a510dbf46cc51a2d5c) Thanks [@0xKheops](https://github.com/0xKheops)! - Add `isDiscovering` to the kheopskit state, and read `window.injectedWeb3` again at window `load` (and 100 ms later) so Polkadot extensions that inject just before `load` are listed. `isDiscovering` is `true` until that `load` read has landed, `false` from the first emission when subscribing after `load`, and `true` on the server.

- [#143](https://github.com/kheopskit/kheopskit/pull/143) [`dd319cf`](https://github.com/kheopskit/kheopskit/commit/dd319cff47893c61ee76f6c2b87814422599499b) Thanks [@0xKheops](https://github.com/0xKheops)! - Hydration ends as soon as the facts allow, and persistence never writes an empty cache for a wallet still connecting.
  
  - `isHydrating` turns `false` once `hydrationGracePeriod` has elapsed, discovery has ended (`isDiscovering` is `false`), and every wallet that hydrated as `connecting` has settled. A wallet has settled when it is absent from the discovered wallets, connected once its account list has been read (an empty list counts; a custom platform plugin not built on kheopskit's account engine settles on its first listed account instead, as in 5.x) or connected with no cached accounts, disconnected with `error` set, or disconnected and not remembered when hydration began. At `hydrationTimeout` hydration ends whatever is pending, and a wallet whose reconnect is still pending stays `connecting`.
  - Discovery ends only after the page fires `load`, so a page with a cache hydrates until `load` or `hydrationTimeout`, whichever comes first, even when no wallet reconnects. With the extension gone, hydration no longer runs to 3 s. It ends once the grace period has elapsed and the page has loaded, or at `hydrationTimeout` if that comes first. MIGRATING_TO_V6.md section 8 lists the cases that hold hydration until the timeout.
  - New `hydrationTimeout` option (default 3000 ms). `hydrationTimeout` replaces the old cap of six times `hydrationGracePeriod` and wins over a longer grace period, so an app that raised `hydrationGracePeriod` sets `hydrationTimeout` as well.
  - When the cache is written, a wallet whose `status` is `connecting` keeps its previous cached entry and accounts. Every other wallet is written from live data.

- [#147](https://github.com/kheopskit/kheopskit/pull/147) [`2b197de`](https://github.com/kheopskit/kheopskit/commit/2b197deba67a66b5bbe6ef0b0e5be9a8494055e1) Thanks [@0xKheops](https://github.com/0xKheops)! - `@kheopskit/react`: `createKheopskit(config, { store? })` also returns `kheopskit$` and `store`, so code outside React shares the provider's pipeline. New hooks `useWallet`, `useAccount` and `useConnect`, and a `store` prop on `KheopskitProvider`. Unmounting the provider now stops its pipeline.

### Patch Changes

- [#148](https://github.com/kheopskit/kheopskit/pull/148) [`ce96842`](https://github.com/kheopskit/kheopskit/commit/ce968421ad52c3ef2b0986fdf3bb7e647edd1352) Thanks [@0xKheops](https://github.com/0xKheops)! - Document the wallet lifecycle (discovery, hydration, reconnect, connect, persistence, signing, testing) with every default and delay in the core README, complete `MIGRATING_TO_V6.md`, add JSDoc to every public config, state, wallet and account field and every error code, and ship `CHANGELOG.md` in both packages.

- [#145](https://github.com/kheopskit/kheopskit/pull/145) [`8878459`](https://github.com/kheopskit/kheopskit/commit/8878459cdcd36563fad908da15df8e9af0a63f8b) Thanks [@0xKheops](https://github.com/0xKheops)! - Docs: a `disconnect()` whose platform call is still pending or refused leaves a granted `connect()` to resolve once the state shows the wallet connected, and a `disconnect()` waiting for the platform settles with the platform's answer.

- [#146](https://github.com/kheopskit/kheopskit/pull/146) [`d750f01`](https://github.com/kheopskit/kheopskit/commit/d750f01414009de816d39076441a8145ec190f7d) Thanks [@0xKheops](https://github.com/0xKheops)! - Fixed: in `kheopskit$`, each wallet's accounts are read on their own stream, started empty when the wallet connects and ended when it disconnects. A wallet that reconnects never shows the accounts of its previous connection and `connect()` never resolves on such an emission; one wallet's pending `eth_accounts` request no longer delays another wallet's accounts or account changes; a wallet connecting or disconnecting no longer makes its siblings re-read their accounts; a Polkadot extension's `accounts.subscribe` runs once per connection.
- Updated dependencies [[`3afa342`](https://github.com/kheopskit/kheopskit/commit/3afa34256a14c67dfa6302743716153a511a5c4b), [`28ef218`](https://github.com/kheopskit/kheopskit/commit/28ef21809d1219bc80ff385faf3625447fabbdb9), [`c04ead2`](https://github.com/kheopskit/kheopskit/commit/c04ead23cfa2b4ba0f7431a510dbf46cc51a2d5c), [`ce96842`](https://github.com/kheopskit/kheopskit/commit/ce968421ad52c3ef2b0986fdf3bb7e647edd1352), [`dd319cf`](https://github.com/kheopskit/kheopskit/commit/dd319cff47893c61ee76f6c2b87814422599499b), [`8878459`](https://github.com/kheopskit/kheopskit/commit/8878459cdcd36563fad908da15df8e9af0a63f8b), [`d750f01`](https://github.com/kheopskit/kheopskit/commit/d750f01414009de816d39076441a8145ec190f7d), [`d8198d3`](https://github.com/kheopskit/kheopskit/commit/d8198d3af41a21dd81d8294a731684ea46427a33), [`4a3c02a`](https://github.com/kheopskit/kheopskit/commit/4a3c02af5009ffe01170548d33a55a9dc4b6366c), [`2b197de`](https://github.com/kheopskit/kheopskit/commit/2b197deba67a66b5bbe6ef0b0e5be9a8494055e1), [`13c1bba`](https://github.com/kheopskit/kheopskit/commit/13c1bba70200012f8b63e65f998b9e9d88b6d1c4), [`0b5d0c1`](https://github.com/kheopskit/kheopskit/commit/0b5d0c1c81da88a08b9284b5c14d2b6e69b2ceeb), [`6365290`](https://github.com/kheopskit/kheopskit/commit/63652909861336ea19986dd141102a00be524808)]:
  - @kheopskit/core@6.0.0-rc.0
  - @kheopskit/react@6.0.0-rc.0

## 5.3.0

### Minor Changes

- [#126](https://github.com/kheopskit/kheopskit/pull/126) [`8d5fe21`](https://github.com/kheopskit/kheopskit/commit/8d5fe21d97026dfebd0a4c2c06312a030a607326) Thanks [@0xKheops](https://github.com/0xKheops)! - Add `appName` config, sent as the dapp name to Polkadot injected extensions so polkadot.js no longer flags a suspicious origin ([#125](https://github.com/kheopskit/kheopskit/issues/125)).

### Patch Changes

- Updated dependencies [[`8d5fe21`](https://github.com/kheopskit/kheopskit/commit/8d5fe21d97026dfebd0a4c2c06312a030a607326)]:
  - @kheopskit/core@5.3.0
  - @kheopskit/react@5.3.0

## 5.2.1

### Patch Changes

- [#91](https://github.com/kheopskit/kheopskit/pull/91) [`1450f7a`](https://github.com/kheopskit/kheopskit/commit/1450f7a474c22e15139264b8cfa66e1d8d2d2d02) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump `@noble/hashes` to 2.4.0 and `@scure/base` to 2.4.0.

- Updated dependencies [[`1450f7a`](https://github.com/kheopskit/kheopskit/commit/1450f7a474c22e15139264b8cfa66e1d8d2d2d02)]:
  - @kheopskit/core@5.2.1
  - @kheopskit/react@5.2.1

## 5.2.0

### Minor Changes

- [#105](https://github.com/kheopskit/kheopskit/pull/105) [`eb0c430`](https://github.com/kheopskit/kheopskit/commit/eb0c430ccfe09a90d7076aaeae07c0170fa808a8) Thanks [@0xKheops](https://github.com/0xKheops)! - Support polkadot-api v3 alongside v2.

  polkadot-api v3 replaced the `PolkadotSigner` interface with `TxCreator`: injected accounts now expose `txCreator` instead of `polkadotSigner`, and `getPolkadotSignerFromPjs` became `getTxCreatorFromPjs`. `@kheopskit/core` detects which one the installed `polkadot-api/pjs-signer` provides at runtime, so `PolkadotAccount` carries `txCreator` on v3 and `polkadotSigner` on v2, for both injected and WalletConnect accounts. The `polkadot-api` peer range stays `>=2.0.0`; apps on v2 are unaffected.

  Adds the `UNSUPPORTED_VERSION` error code, thrown when neither factory is found.

### Patch Changes

- Updated dependencies [[`eb0c430`](https://github.com/kheopskit/kheopskit/commit/eb0c430ccfe09a90d7076aaeae07c0170fa808a8)]:
  - @kheopskit/core@5.2.0
  - @kheopskit/react@5.2.0

## 5.1.2

### Patch Changes

- [#81](https://github.com/kheopskit/kheopskit/pull/81) [`55e7091`](https://github.com/kheopskit/kheopskit/commit/55e70912343763a8ee31a981f6332b06b6293f8e) Thanks [@0xKheops](https://github.com/0xKheops)! - Fix broken type declarations published in `@kheopskit/react@5.1.1`, where `useAccounts()` collapsed to `any` and `useWallets()` referenced undeclared identifiers. Consumers saw a wave of `TS7006: Parameter implicitly has an 'any' type` errors on accounts and wallets.

- Updated dependencies [[`55e7091`](https://github.com/kheopskit/kheopskit/commit/55e70912343763a8ee31a981f6332b06b6293f8e)]:
  - @kheopskit/core@5.1.2
  - @kheopskit/react@5.1.2

## 5.1.1

### Patch Changes

- [#71](https://github.com/kheopskit/kheopskit/pull/71) [`8da651c`](https://github.com/kheopskit/kheopskit/commit/8da651c1bd8d4bf5b698df4ba6784f786820d11c) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump `@noble/hashes` to `^2.2.0`. The 2.x export map dropped extensionless subpaths, so the internal address validators now import from `@noble/hashes/sha3.js` and `@noble/hashes/blake2.js` (`blake2b` no longer has its own module). No API or behavior change.

- [#68](https://github.com/kheopskit/kheopskit/pull/68) [`f1e8049`](https://github.com/kheopskit/kheopskit/commit/f1e804978b807fdfff1126d54431a642fbc4f83b) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump `@scure/base` to `^2.2.0`, aligning core with the range the examples already use. The `base58`/`base64` coders used by the address validators and the Solana signer are unchanged; no API or behavior change.

- [#77](https://github.com/kheopskit/kheopskit/pull/77) [`6f225b7`](https://github.com/kheopskit/kheopskit/commit/6f225b7e2396437da20d30c3dfd96ceb36795ae7) Thanks [@0xKheops](https://github.com/0xKheops)! - Build both packages with [tsdown](https://tsdown.dev) instead of tsup, and move the toolchain to TypeScript 7.

  TypeScript 7 only ships a stable `tsc` binary — its main entry now exports just `version`, and the compiler API moved to `typescript/unstable/*`. Every tool that reaches for `require('typescript')` breaks, including the `rollup-plugin-dts` that tsup uses for declaration emit. tsdown declares support for TypeScript 7 and is tsup's successor.

  The published layout is unchanged: `dist/index.mjs` + `dist/index.d.mts` for ESM and `dist/index.js` + `dist/index.d.ts` for CJS (`fixedExtension: false` preserves tsup's extensions), all `exports` entries resolve, the `"use client"` banner is still emitted for `@kheopskit/react`, and the per-entry bundle isolation check still passes for all 16 entry bundles. Chunk file names differ, since the bundler differs.

- Updated dependencies [[`8da651c`](https://github.com/kheopskit/kheopskit/commit/8da651c1bd8d4bf5b698df4ba6784f786820d11c), [`f1e8049`](https://github.com/kheopskit/kheopskit/commit/f1e804978b807fdfff1126d54431a642fbc4f83b), [`6f225b7`](https://github.com/kheopskit/kheopskit/commit/6f225b7e2396437da20d30c3dfd96ceb36795ae7)]:
  - @kheopskit/core@5.1.1
  - @kheopskit/react@5.1.1

## 5.1.0

### Minor Changes

- [#58](https://github.com/kheopskit/kheopskit/pull/58) [`4bdd521`](https://github.com/kheopskit/kheopskit/commit/4bdd521c067fb9e5e6c78c2a9b6ba465cfbacadd) Thanks [@0xKheops](https://github.com/0xKheops)! - Internal architecture refactor (behavior-preserving):

  - New public `getHydratedSnapshot` helper — the single implementation of the cached-state hydration pipeline, shared by core's observable seed and the React provider's `serverValue`/`initialValue` (which no longer import from `@kheopskit/core/internal`).
  - Platform plugins now share one injected-wallets engine (`createInjectedWallets$`) and one accounts pipeline (`createPlatformAccounts$`) instead of triplicating the connect/disconnect state machine, change detection, and WalletConnect CAIP-10 session parsing.
  - Auto-reconnect bookkeeping extracted into a tested reconnect policy (bounded retries unchanged).
  - Compact cookie codec split out of `store.ts` into its own module; `KheopskitStore` is now a structural type in `types.ts` (no more type-level `types ↔ store` import cycle).
  - React's `useSyncExternalStore` adapter renamed `createStore` → `createExternalStore` (internal; not exported).
  - Removed dead code: unused `sleep`/`throwAfter`/`getAccountAddressType` utils, the deprecated `store` singleton export, dead `defaultStore` parameter defaults.
  - `@kheopskit/core/internal` no longer exports `acceptsCachedAccount`, `hydrateWallet`, `hydrateAccount`, `getCachedIcon`, `sortWallets`, `sortAccounts` (subsumed by the public `getHydratedSnapshot`; the `/internal` entry is documented as non-semver).
  - Fixed a stray comma text node rendered by the vite example; CI lint now fails on warnings like the pre-commit hook.

### Patch Changes

- Updated dependencies [[`4bdd521`](https://github.com/kheopskit/kheopskit/commit/4bdd521c067fb9e5e6c78c2a9b6ba465cfbacadd)]:
  - @kheopskit/core@5.1.0
  - @kheopskit/react@5.1.0

## 5.0.1

### Patch Changes

- [`98786a2`](https://github.com/kheopskit/kheopskit/commit/98786a2a8bcbafe3314637c1388c3e49255da242) Thanks [@0xKheops](https://github.com/0xKheops)! - fix chain switching

- Updated dependencies [[`98786a2`](https://github.com/kheopskit/kheopskit/commit/98786a2a8bcbafe3314637c1388c3e49255da242)]:
  - @kheopskit/core@5.0.1
  - @kheopskit/react@5.0.1

## 5.0.0

### Major Changes

- [#55](https://github.com/kheopskit/kheopskit/pull/55) [`75333cf`](https://github.com/kheopskit/kheopskit/commit/75333cfa6636edc3b32070136367ef01fef0a9ed) Thanks [@0xKheops](https://github.com/0xKheops)! - WalletConnect is now a single, platform-less connector instead of one wallet per platform.

  A WalletConnect session is shared across every namespace and is established in a single pairing, so `wallets` now contains exactly one `WalletConnectWallet` (`type: "walletconnect"`, no `platform`) with a `platforms: WalletPlatform[]` array of the namespaces the live session actually approved. Its accounts still appear in `accounts`, each carrying its own `platform`.

  This fixes the previous behaviour where each platform showed its own "WalletConnect" connect button — only the first did anything, and disconnecting one tore down the whole session.

  BREAKING CHANGES:

  - Removed `AppKitWallet`, `PolkadotAppKitWallet`, `EthereumAppKitWallet`, `SolanaAppKitWallet`. Use `WalletConnectWallet` together with the `isWalletConnectWallet(wallet)` type guard (exported from `@kheopskit/core` and from each platform entry point).
  - `WalletType` is now `"injected" | "walletconnect"` (`"appKit"` removed).
  - The WalletConnect entry has no `platform` field — narrow with `isWalletConnectWallet(wallet)` before reading `wallet.platform`. Per-platform wallet filters (`wallets.filter(w => w.platform === "polkadot")`) no longer match it; find it with `wallets.find(isWalletConnectWallet)`.
  - Connect/disconnect are session-wide: connecting opens one modal and the wallet approves whichever namespaces it supports; a namespace cannot be added to a live session (disconnect and re-pair to change the approved set).
  - `getKheopskit$` takes an options object instead of positional arguments: `getKheopskit$(config, ssrCookies?, store?)` → `getKheopskit$(config, { ssrCookies?, store? })`. The React `KheopskitProvider` is unaffected.

  ***

  This release also hardens the multi-platform connector and the surrounding pipeline.

  **Fixes**

  - WalletConnect: the Reown AppKit instance is now created at most once per process. Previously a `KheopskitProvider` unmount/remount (or React StrictMode) could re-run `createAppKit`, which throws on Reown's duplicate web-component / modal singleton.
  - Ethereum over WalletConnect: accounts now surface even when `eth_chainId` rejects or returns an unparseable value — the chain id falls back to the session-advertised chain and refines from there. Previously the account list could silently never appear.
  - The persisted snapshot now updates on an Ethereum chain switch; the cached `chainId` was previously skipped because an account id is chain-independent.
  - Solana over WalletConnect: AppKit's deprecated CAIP-2 cluster ids are now recognised, so a session advertising them is labelled with the right cluster instead of falling back to the configured chain.
  - `KheopskitProvider` subscribes to the underlying observable from a committed effect, not during render, so a discarded render (StrictMode / concurrent rendering) can no longer leak a subscription. The internal store also no longer double-invokes a subscriber's initial callback.
  - Auto-reconnect caps retries per wallet, so a permanently-failing `connect()` (e.g. a permission denied) is no longer retried on every `wallets$` emission.
  - The WalletConnect Ethereum provider wrapper no longer mutates the caller's request object.
  - The UI state comparator now reflects WalletConnect `platforms` (and wallet name/icon) changes, so the list updates when the approved namespaces change.

  **DX**

  - `@kheopskit/react` ships a `"use client"` banner, so `KheopskitProvider`, `useWallets` and `useAccounts` can be imported directly into a Next.js App Router Server Component without a manual client-boundary wrapper.
  - New public exports: `isInjectedWallet` (the complement of `isWalletConnectWallet`, from `@kheopskit/core` and each platform entry point), plus `parseWalletAccountId` and `isValidWalletId` from `@kheopskit/core`.
  - `KheopskitError.walletId` is now typed `WalletId` instead of `string`.
  - Both packages declare `"sideEffects": false` and split their `types` per `import`/`require` condition for correct ESM/CJS type resolution.
  - `KheopskitProvider` warns in development when it receives a new `config` reference on each render — the footgun that recreates the store and re-subscribes every render. Pass a stable config (module scope, `useMemo`, or `createKheopskit`).

### Patch Changes

- Updated dependencies [[`75333cf`](https://github.com/kheopskit/kheopskit/commit/75333cfa6636edc3b32070136367ef01fef0a9ed)]:
  - @kheopskit/core@5.0.0
  - @kheopskit/react@5.0.0

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

- Updated dependencies [[`ef02b3a`](https://github.com/kheopskit/kheopskit/commit/ef02b3ade87c04c1732e746f4490b70b94b85451)]:
  - @kheopskit/core@5.0.0
  - @kheopskit/react@5.0.0

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
