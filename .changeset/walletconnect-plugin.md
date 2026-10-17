---
"kheopskit": major
"@kheopskit/core": major
"@kheopskit/react": major
---

WalletConnect is a plugin from the new `@kheopskit/core/walletconnect` entry. A dapp that does not import it bundles none of kheopskit's AppKit code and no AppKit chunks.

- `config.walletConnect` takes `walletConnect({ projectId, metadata, networks })`. A raw options object is a type error, and `getKheopskit$` throws a `KheopskitError` with the new code `INVALID_CONFIG`.
- `resetAppKitCache` moved to `@kheopskit/core/walletconnect`.
- `WalletConnectConfig` is now `WalletConnectOptions`, exported from `@kheopskit/core/walletconnect`. The unused `relayUrl` option is removed.
