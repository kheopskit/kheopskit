---
"kheopskit": major
"@kheopskit/core": major
"@kheopskit/react": major
---

WalletConnect is now a single, platform-less connector instead of one wallet per platform.

A WalletConnect session is shared across every namespace and is established in a single pairing, so `wallets` now contains exactly one `WalletConnectWallet` (`type: "walletconnect"`, no `platform`) with a `platforms: WalletPlatform[]` array of the namespaces the live session actually approved. Its accounts still appear in `accounts`, each carrying its own `platform`.

This fixes the previous behaviour where each platform showed its own "WalletConnect" connect button — only the first did anything, and disconnecting one tore down the whole session.

BREAKING CHANGES:

- Removed `AppKitWallet`, `PolkadotAppKitWallet`, `EthereumAppKitWallet`, `SolanaAppKitWallet`. Use `WalletConnectWallet` together with the `isWalletConnectWallet(wallet)` type guard (exported from `@kheopskit/core` and from each platform entry point).
- `WalletType` is now `"injected" | "walletconnect"` (`"appKit"` removed).
- The WalletConnect entry has no `platform` field — narrow with `isWalletConnectWallet(wallet)` before reading `wallet.platform`. Per-platform wallet filters (`wallets.filter(w => w.platform === "polkadot")`) no longer match it; find it with `wallets.find(isWalletConnectWallet)`.
- Connect/disconnect are session-wide: connecting opens one modal and the wallet approves whichever namespaces it supports; a namespace cannot be added to a live session (disconnect and re-pair to change the approved set).
- `getKheopskit$` takes an options object instead of positional arguments: `getKheopskit$(config, ssrCookies?, store?)` → `getKheopskit$(config, { ssrCookies?, store? })`. The React `KheopskitProvider` is unaffected.

---

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
