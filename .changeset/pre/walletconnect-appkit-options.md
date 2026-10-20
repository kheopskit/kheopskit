---
"kheopskit": minor
"@kheopskit/core": minor
"@kheopskit/react": minor
---

Added: `walletConnect({ appKitOptions })` forwards any other Reown `createAppKit` option to AppKit, such as `featuredWalletIds`, `features` or `allWallets`. The keys kheopskit sets (`projectId`, `metadata`, `networks`, `themeMode`, `themeVariables`, `universalProviderConfigOverride`) are rejected by the type and keep their kheopskit values.
