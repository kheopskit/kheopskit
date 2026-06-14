---
"kheopskit": major
"@kheopskit/core": major
"@kheopskit/react": major
---

v4 API ergonomics and breaking-change cleanup (landed alongside the Solana / plugin work).

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
