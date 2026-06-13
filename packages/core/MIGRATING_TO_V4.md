# Migrating to Kheopskit v4

v4 turns each chain into a **plugin** behind its own entry point, and makes every
platform SDK (plus WalletConnect) an **optional peer dependency**. A dapp now
installs and bundles only what it actually uses.

`@kheopskit/core`, `@kheopskit/react` and the repo release tag are unified at
**`4.0.0`** and move in lockstep from here on.

---

## At a glance

| Area | v3 | v4 |
|------|----|----|
| Enable platforms | `platforms: ["polkadot", "ethereum"]` | `platforms: [polkadot(), ethereum()]` (plugin factories) |
| Platform options | top-level `polkadotAccountTypes`, `solanaChain` | `polkadot({ accountTypes })`, `solana({ chain })` |
| SDK install | bundled in core | optional peer deps — install per platform |
| WalletConnect | `@reown/appkit` bundled | optional peer dep — install only if you use it |
| Platform types | from `@kheopskit/core` | from `@kheopskit/core/<platform>` |
| Precise React types | `useWallets()` | `useWallets<typeof platforms>()` |
| `account.isWalletDefault` | present (Ethereum/Solana) | **removed** |

---

## 1. Install only what you use

`rxjs` is always required. Everything else is optional — add the row(s) for the
platforms (and WalletConnect) you actually use:

```bash
# always
pnpm add @kheopskit/core @kheopskit/react rxjs

# per platform — pick what you use
pnpm add polkadot-api                                   # Polkadot
pnpm add viem mipd                                      # Ethereum
pnpm add @solana/kit @wallet-standard/app @wallet-standard/base   # Solana

# only if you pass config.walletConnect
pnpm add @reown/appkit
```

A Polkadot-only dapp that doesn't use WalletConnect installs none of the
Ethereum/Solana SDKs nor `@reown/appkit`, and none of their code is pulled into
its bundle.

## 2. Platforms are plugins

Import a factory from each platform's entry point and pass instances to
`config.platforms`. `platforms` is now **required** (no default).

```diff
  import { getKheopskit$ } from "@kheopskit/core";
+ import { polkadot } from "@kheopskit/core/polkadot";
+ import { ethereum } from "@kheopskit/core/ethereum";
+ import { solana } from "@kheopskit/core/solana";

  getKheopskit$({
-   platforms: ["polkadot", "ethereum", "solana"],
-   polkadotAccountTypes: ["sr25519", "ed25519"],
-   solanaChain: "solana:devnet",
+   platforms: [
+     polkadot({ accountTypes: ["sr25519", "ed25519"] }),
+     ethereum(),
+     solana({ chain: "solana:devnet" }),
+   ],
  });
```

- `polkadotAccountTypes` → `polkadot({ accountTypes })`.
- `solanaChain` → `solana({ chain })` (defaults to `"solana:mainnet"`).
- `autoReconnect`, `walletConnect`, `debug`, `storageKey`, `hydrationGracePeriod`
  stay at the top level, unchanged.

## 3. Platform types move to the platform entry points

```diff
- import type { PolkadotAccount, EthereumAccount } from "@kheopskit/core";
+ import type { PolkadotAccount } from "@kheopskit/core/polkadot";
+ import type { EthereumAccount } from "@kheopskit/core/ethereum";
+ import type { SolanaAccount } from "@kheopskit/core/solana";
```

`KheopskitConfig`, `KheopskitState`, `BaseWallet`, `BaseWalletAccount` and the
WalletConnect/AppKit types remain on the root `@kheopskit/core`.

## 4. React: recover precise account types

React context can't be generic, so `useWallets()` returns the SDK-free base
shapes. Pass your platform tuple to get platform-precise types
(`account.signer` on Solana, `account.client` on Ethereum, …):

```diff
- const { accounts } = useWallets();
+ const platforms = [polkadot(), ethereum(), solana()] as const;
+ // ...pass `platforms` to your KheopskitProvider config...
+ const { accounts } = useWallets<typeof platforms>();
```

Define `platforms` once (e.g. exported `as const` from your config module) and
reuse it for both the provider config and the `useWallets` type argument.

> During hydration (`state.isHydrating === true`) accounts/wallets are cached
> placeholders that carry only the base fields — SDK fields (`signer`, `client`,
> provider/extension handles) are **absent at runtime** even though the types
> show them. Guard SDK-field access behind `!isHydrating`.

## 5. WalletConnect is optional

`@reown/appkit` is no longer bundled. Install it only if you set
`config.walletConnect`:

```bash
pnpm add @reown/appkit
```

If `config.walletConnect` is set but `@reown/appkit` isn't installed,
WalletConnect is disabled with a console error and injected wallets keep working.

Two WalletConnect types are now loosened so core doesn't depend on
`@reown/appkit`'s types:

- `config.walletConnect.networks` is typed `unknown[]`. Keep passing
  `AppKitNetwork[]` from `@reown/appkit/networks` — it's forwarded as-is.
- A wallet's `appKit` escape hatch is typed as a minimal local `AppKitInstance`.
  Cast it to `@reown/appkit`'s `AppKit` if you need the full API:
  `wallet.appKit as unknown as import("@reown/appkit").AppKit`.

## 6. `isWalletDefault` removed

The unused, never-persisted `isWalletDefault` field was removed from
`EthereumAccount` and `SolanaAccount`. If you relied on "first account",
compute it from array position yourself (`accounts[0]`).

---

## Upgrade checklist

- [ ] Bump `@kheopskit/core` and `@kheopskit/react` to `^4.0.0`.
- [ ] Install the peer deps for the platforms you use (+ `@reown/appkit` if using WalletConnect).
- [ ] Replace `platforms: [...strings]` with plugin factories from the subpath entries.
- [ ] Move `polkadotAccountTypes` / `solanaChain` into `polkadot({ accountTypes })` / `solana({ chain })`.
- [ ] Update platform-type imports to the subpath entries.
- [ ] Switch `useWallets()` → `useWallets<typeof platforms>()` where you read SDK fields.
- [ ] Remove any use of `account.isWalletDefault`.
- [ ] Run `tsc` — remaining type errors point at anything missed.
