---
"kheopskit": minor
"@kheopskit/core": minor
"@kheopskit/react": minor
---

Add Solana as a third `WalletPlatform`, with support for both injected wallets (via the Wallet Standard) and WalletConnect (via Reown AppKit).

Solana accounts expose `@solana/kit` signer interfaces (`signer` / `getSigner(chain)`), mirroring how Polkadot accounts expose a `PolkadotSigner` and Ethereum accounts expose a viem client. A new `solanaChain` config option selects the cluster the signers target (default `"solana:mainnet"`).

`@solana/kit` is a new peer dependency of `@kheopskit/core` (alongside `polkadot-api`); install it when using kheopskit.
