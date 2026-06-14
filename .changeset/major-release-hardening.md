---
"kheopskit": major
"@kheopskit/core": major
"@kheopskit/react": major
---

Correctness, DX, and packaging hardening pass.

**Breaking**

- `getKheopskit$` takes an options object instead of positional arguments:
  `getKheopskit$(config, ssrCookies?, store?)` → `getKheopskit$(config, { ssrCookies?, store? })`.
  The React `KheopskitProvider` is unaffected.

**Fixes**

- WalletConnect: the Reown AppKit instance is now created at most once per
  process. Previously a `KheopskitProvider` unmount/remount (or React StrictMode)
  could re-run `createAppKit`, which throws on Reown's duplicate web-component /
  modal singleton.
- Ethereum over WalletConnect: accounts now surface even when `eth_chainId`
  rejects or returns an unparseable value — the chain id falls back to the
  session-advertised chain and refines from there. Previously the account list
  could silently never appear.
- The persisted snapshot now updates on an Ethereum chain switch; the cached
  `chainId` was previously skipped because an account id is chain-independent.
- Solana over WalletConnect: AppKit's deprecated CAIP-2 cluster ids are now
  recognised, so a session advertising them is labelled with the right cluster
  instead of falling back to the configured chain.
- `KheopskitProvider` subscribes to the underlying observable from a committed
  effect, not during render, so a discarded render (StrictMode / concurrent
  rendering) can no longer leak a subscription. The internal store also no longer
  double-invokes a subscriber's initial callback.
- Auto-reconnect caps retries per wallet, so a permanently-failing `connect()`
  (e.g. a permission denied) is no longer retried on every `wallets$` emission.
- The WalletConnect Ethereum provider wrapper no longer mutates the caller's
  request object.
- The UI state comparator now reflects WalletConnect `platforms` (and wallet
  name/icon) changes, so the list updates when the approved namespaces change.

**DX**

- `@kheopskit/react` ships a `"use client"` banner, so `KheopskitProvider`,
  `useWallets` and `useAccounts` can be imported directly into a Next.js App
  Router Server Component without a manual client-boundary wrapper.
- New public exports: `isInjectedWallet` (the complement of
  `isWalletConnectWallet`, from `@kheopskit/core` and each platform entry point),
  plus `parseWalletAccountId` and `isValidWalletId` from `@kheopskit/core`.
- `KheopskitError.walletId` is now typed `WalletId` instead of `string`.
- Both packages declare `"sideEffects": false` and split their `types` per
  `import`/`require` condition for correct ESM/CJS type resolution.
- `KheopskitProvider` warns in development when it receives a new `config`
  reference on each render — the footgun that recreates the store and
  re-subscribes every render. Pass a stable config (module scope, `useMemo`, or
  `createKheopskit`).
