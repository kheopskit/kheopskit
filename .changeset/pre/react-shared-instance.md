---
"kheopskit": minor
"@kheopskit/core": minor
"@kheopskit/react": minor
---

`@kheopskit/react`: `createKheopskit(config, { store? })` also returns `kheopskit$` and `store`, so code outside React shares the provider's pipeline. New hooks `useWallet`, `useAccount` and `useConnect`, and a `store` prop on `KheopskitProvider`. Unmounting the provider now stops its pipeline.
