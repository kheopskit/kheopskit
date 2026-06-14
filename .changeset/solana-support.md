---
"kheopskit": major
"@kheopskit/core": major
"@kheopskit/react": major
---

Add Solana support and move to a plugin / subpath-exports architecture so dapps install only the SDKs for the platforms they use.

**New: Solana** — injected wallets via the Wallet Standard, WalletConnect via Reown AppKit. Solana accounts expose `@solana/kit` signer interfaces (`signer` / `getSigner(chain)`).

**Breaking: platforms are now plugins.** Each platform lives behind its own entry point and brings its own optional peer dependencies. A Polkadot-only dapp never pulls Ethereum/Solana code or their SDKs (`viem`, `@solana/kit`, `mipd`, `@wallet-standard/*`) into its bundle or type-check.

Migration:

```diff
- import { getKheopskit$ } from "@kheopskit/core";
+ import { getKheopskit$ } from "@kheopskit/core";
+ import { polkadot } from "@kheopskit/core/polkadot";
+ import { solana } from "@kheopskit/core/solana";

  getKheopskit$({
-   platforms: ["polkadot", "solana"],
-   polkadotAccountTypes: ["sr25519"],
-   solanaChain: "solana:devnet",
+   platforms: [
+     polkadot({ accountTypes: ["sr25519"] }),
+     solana({ chain: "solana:devnet" }),
+   ],
  });
```

- `config.platforms` takes plugin objects (from `@kheopskit/core/<platform>`), and is required (no default).
- `polkadotAccountTypes` and `solanaChain` move into `polkadot({ accountTypes })` and `solana({ chain })`.
- Platform types (`PolkadotAccount`, `EthereumAccount`, `SolanaAccount`, `WalletAccount`, …) are exported from the platform entry points, not the package root.
- `viem` is now an (optional) peer dependency instead of a bundled dependency; `mipd` and `@wallet-standard/*` likewise. Install the SDKs for the platforms you use (see README).
- React: `useWallets()` returns the SDK-free base shapes; call `useWallets<typeof platforms>()` to recover platform-precise account/wallet types (React contexts cannot be generic).

Address validation in core is unchanged — it now uses `@scure/base` + `@noble/hashes` directly instead of the platform SDKs.
