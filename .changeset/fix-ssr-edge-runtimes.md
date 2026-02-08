---
"@kheopskit/core": patch
"@kheopskit/react": patch
---

fix: SSR compatibility with edge runtimes like Cloudflare Workers

- Lazy initialize `safeLocalStorage` to avoid accessing browser globals at module load
- Lazy initialize default store via `getDefaultStore()` for SSR safety
- Dynamically import `@reown/appkit/core` to prevent Lit (browser-only) code from loading on server
- Add SSR safety tests to prevent regressions
- Export `getDefaultStore` and `getSafeLocalStorage` for advanced use cases
