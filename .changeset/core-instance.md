---
"kheopskit": minor
"@kheopskit/core": minor
"@kheopskit/react": minor
---

Breaking: `getKheopskit$` and its `GetKheopskitOptions` type are removed from `@kheopskit/core`; create one instance with `createKheopskit(config, options)` and subscribe its `kheopskit$` once at app start. A `@kheopskit/react` provider that receives `ssrCookies` needs an instance created with `createKheopskit(config, { ssr: true })`; without it, `ssrCookies` is a type error. On the server, a store that `createKheopskit` creates ignores `rememberWallet`, `forgetWallet` and `setCachedState`, so module code shared by every request cannot change it.

Added: `createKheopskit` in `@kheopskit/core` returns `kheopskit$` and `store`. Every subscriber of `kheopskit$` shares one pipeline, which runs while something subscribes, and a wallet's `connect()` and `disconnect()` act on the pipeline running when they are called. `@kheopskit/react`'s `createKheopskit` is built on it. `@kheopskit/core/internal` gains the instance plumbing that `@kheopskit/react` uses; it is not public API.
