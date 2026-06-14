# @kheopskit/react

React bindings for [Kheopskit](https://github.com/kheopskit/kheopskit) — list
wallets and accounts across Polkadot, Ethereum and Solana, with injected wallets
and WalletConnect (Reown AppKit).

The framework-agnostic core lives in
[`@kheopskit/core`](https://www.npmjs.com/package/@kheopskit/core).
Full docs and the interactive playground:
https://github.com/kheopskit/kheopskit

> **Upgrading from v3?** v4 moves platforms to plugins and makes platform SDKs
> (and WalletConnect) optional peer dependencies. See
> [MIGRATING_TO_V4.md](../core/MIGRATING_TO_V4.md).

## Install

`rxjs` is always required; every platform SDK (and WalletConnect) is an optional
peer dependency — install only what you use:

```bash
pnpm add @kheopskit/core @kheopskit/react rxjs

pnpm add polkadot-api                                            # Polkadot
pnpm add viem mipd                                               # Ethereum
pnpm add @solana/kit @wallet-standard/app @wallet-standard/base  # Solana
pnpm add @reown/appkit                                           # WalletConnect (optional)
```

## Usage

Recommended: bind your platform tuple once with `createKheopskit` and get a
provider plus hooks already typed to those platforms — no generic to repeat.

```ts
// kheopskit.ts
import { createKheopskit } from "@kheopskit/react";
import { polkadot } from "@kheopskit/core/polkadot";
import { ethereum } from "@kheopskit/core/ethereum";
import { solana } from "@kheopskit/core/solana";

export const { KheopskitProvider, useWallets, useAccounts } = createKheopskit({
  platforms: [polkadot(), ethereum(), solana()],
  autoReconnect: true,
});
```

```tsx
// app.tsx
import { KheopskitProvider } from "./kheopskit";

export const App = ({ children }: { children: React.ReactNode }) => (
  <KheopskitProvider>{children}</KheopskitProvider>
);
```

```tsx
// anywhere — accounts/wallets are platform-precise (account.signer / account.client typed)
import { useWallets, useAccounts } from "./kheopskit";

const { wallets, isHydrating } = useWallets();
const accounts = useAccounts();
```

### Without the factory

You can also use the `KheopskitProvider` component directly and recover precise
types with a type argument (React context can't be generic):

```tsx
import { KheopskitProvider, useWallets } from "@kheopskit/react";

const platforms = [polkadot(), ethereum(), solana()] as const;

<KheopskitProvider config={{ platforms }}>…</KheopskitProvider>;

const { accounts } = useWallets<typeof platforms>();
```

## SSR

Pass the request cookie header as `ssrCookies` to hydrate wallet state on the
server without a UI flash:

```tsx
// Next.js App Router
const cookieStore = await cookies();
const ssrCookies = cookieStore
  .getAll()
  .map((c) => `${c.name}=${c.value}`)
  .join("; ");

<KheopskitProvider ssrCookies={ssrCookies}>{children}</KheopskitProvider>;
```

> While `state.isHydrating` is `true`, wallets/accounts are cached placeholders
> carrying only the base fields — SDK fields (`signer`, `client`,
> provider/extension handles) are absent until hydration completes. Guard access
> behind `!isHydrating`.

## License

ISC
