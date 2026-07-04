---
"kheopskit": minor
"@kheopskit/core": minor
"@kheopskit/react": minor
---

Internal architecture refactor (behavior-preserving):

- New public `getHydratedSnapshot` helper — the single implementation of the cached-state hydration pipeline, shared by core's observable seed and the React provider's `serverValue`/`initialValue` (which no longer import from `@kheopskit/core/internal`).
- Platform plugins now share one injected-wallets engine (`createInjectedWallets$`) and one accounts pipeline (`createPlatformAccounts$`) instead of triplicating the connect/disconnect state machine, change detection, and WalletConnect CAIP-10 session parsing.
- Auto-reconnect bookkeeping extracted into a tested reconnect policy (bounded retries unchanged).
- Compact cookie codec split out of `store.ts` into its own module; `KheopskitStore` is now a structural type in `types.ts` (no more type-level `types ↔ store` import cycle).
- React's `useSyncExternalStore` adapter renamed `createStore` → `createExternalStore` (internal; not exported).
- Removed dead code: unused `sleep`/`throwAfter`/`getAccountAddressType` utils, the deprecated `store` singleton export, dead `defaultStore` parameter defaults.
- `@kheopskit/core/internal` no longer exports `acceptsCachedAccount`, `hydrateWallet`, `hydrateAccount`, `getCachedIcon`, `sortWallets`, `sortAccounts` (subsumed by the public `getHydratedSnapshot`; the `/internal` entry is documented as non-semver).
- Fixed a stray comma text node rendered by the vite example; CI lint now fails on warnings like the pre-commit hook.
