# Kheopskit

Kheopskit is a library designed to simplify the development of multi-chain DApps (Polkadot, Ethereum, Solana). It provides tools to:

- List all installed wallets and connect/disconnect them.
- List all accounts from those wallets.
- Support Polkadot, Ethereum, and Solana wallets.
- Handle identical accounts injected by multiple wallets.

Try it on the [interactive playground](https://Kheopskit.pages.dev/)

See [Kheopswap](https://github.com/kheopswap/kheopswap) for a production DApp built using Kheopskit.

> **Upgrading from v3?** v4 moves platforms to plugins and makes platform SDKs (and WalletConnect) optional peer dependencies. See the [v4 migration guide](./packages/core/MIGRATING_TO_V4.md).

## Features

- **Multi-wallet support**: Easily interact with Polkadot, Ethereum, and Solana wallets.
- **Account management**: Manage accounts from all connected wallets in a single list.
- **Modern tech stack**: Designed for use with polkadot-api (PAPI), viem, and @solana/kit.

---

## Installation

Install the required packages using `pnpm`:

```bash
pnpm add @kheopskit/core @kheopskit/react
```

Each platform lives behind its own entry point and brings its own (optional) peer dependencies. **Install only the platforms you use:**

| Platform | Entry point | Install |
|----------|-------------|---------|
| Polkadot | `@kheopskit/core/polkadot` | `pnpm add polkadot-api` |
| Ethereum | `@kheopskit/core/ethereum` | `pnpm add viem mipd` |
| Solana | `@kheopskit/core/solana` | `pnpm add @solana/kit @wallet-standard/app @wallet-standard/base` |

WalletConnect support (via Reown AppKit, across any platform) is also optional — install it only if you pass `config.walletConnect`:

| Feature | Install |
|---------|---------|
| WalletConnect | `pnpm add @reown/appkit` |

`rxjs` is always required. Everything else is an optional peer dependency: a Polkadot-only dapp that doesn't use WalletConnect installs neither the Ethereum/Solana SDKs nor `@reown/appkit`, and none of their code is pulled into your bundle. If `config.walletConnect` is set but `@reown/appkit` isn't installed, WalletConnect is disabled with a console error while injected wallets keep working.

---

## Usage

### With React

Platforms are enabled by passing **plugins** (imported from their entry points) to `config.platforms`. Bind them once with `createKheopskit` to get a `KheopskitProvider` plus `useWallets` / `useAccounts` hooks already typed to those platforms — no generic to repeat.

```tsx
// kheopskit.ts
import { createKheopskit } from "@kheopskit/react";
import { polkadot } from "@kheopskit/core/polkadot";
import { ethereum } from "@kheopskit/core/ethereum";

export const { KheopskitProvider, useWallets, useAccounts } = createKheopskit({
  platforms: [polkadot(), ethereum()],
  autoReconnect: true,
});
```

```tsx
// app.tsx
import { KheopskitProvider, useWallets } from "./kheopskit";

const Wallets = () => {
  const { wallets, accounts } = useWallets(); // platform-precise, no type argument

  return (
    <div>
      <h1>Wallets</h1>
      {wallets.map((wallet) => (
        <div key={wallet.id}>
          [{wallet.platform}] {wallet.name}
          {wallet.isConnected ? (
            <button onClick={() => wallet.disconnect()}>Disconnect</button>
          ) : (
            <button onClick={() => wallet.connect()}>Connect</button>
          )}
        </div>
      ))}

      <h1>Accounts</h1>
      {accounts.map((account) => (
        <p key={account.address}>
          [{account.platform}] {account.name} - {account.address}
        </p>
      ))}
    </div>
  );
};

export const App = () => (
  <KheopskitProvider>
    <Wallets />
  </KheopskitProvider>
);
```

> **Prefer the component directly?** Use `<KheopskitProvider config={{ platforms }}>` and recover platform-precise account types (e.g. `account.signer` on Solana, `account.client` on Ethereum) with a type argument — `useWallets<typeof platforms>()`. React context can't be generic, so the bare `useWallets()` returns the SDK-free base shapes. Pass a **referentially stable** `config` (module scope, `useMemo`, or `createKheopskit`); a new object each render recreates the store and re-subscribes.

> **Reading a wallet's SDK handle?** `state.wallets` mixes injected wallets with the single, platform-less WalletConnect connector. Narrow with `isInjectedWallet(wallet)` (the complement of `isWalletConnectWallet`) to recover `wallet.platform`, `wallet.sourceId`, and the injected SDK handle (`provider` on Ethereum, `extension` on Polkadot, `wallet` on Solana).

### With Vanilla JavaScript and RxJS

1. Instantiate a Kheopskit observable with `getKheopskit$(config)`.
2. Subscribe to the observable to access wallets and accounts.

```javascript
import { getKheopskit$ } from "@kheopskit/core";
import { polkadot } from "@kheopskit/core/polkadot";
import { ethereum } from "@kheopskit/core/ethereum";

const config = {
  platforms: [polkadot(), ethereum()],
  autoReconnect: true,
};
const kheopskit$ = getKheopskit$(config);

kheopskit$.subscribe(({ wallets, accounts }) => {
  console.log("Wallets:", wallets);
  console.log("Accounts:", accounts);
});
```

### Polkadot account type filtering

Pass `accountTypes` to the `polkadot()` plugin to control which Polkadot account key types are exposed in `accounts`.

- Supported values: `"sr25519"`, `"ed25519"`, `"ecdsa"`, `"ethereum"`
- Default: `["sr25519", "ed25519", "ecdsa"]`
- `"ethereum"` is excluded by default and must be opted in explicitly

Example including Ethereum-style Polkadot accounts:

```ts
import { polkadot } from "@kheopskit/core/polkadot";

const config = {
  platforms: [
    polkadot({ accountTypes: ["sr25519", "ed25519", "ecdsa", "ethereum"] }),
  ],
  autoReconnect: true,
};
```

### Solana

Add the `solana()` plugin to `platforms` to surface Solana wallets. Injected wallets are discovered via the [Wallet Standard](https://github.com/anza-xyz/wallet-standard); WalletConnect is supported through Reown AppKit.

Each Solana account exposes a signer built on [`@solana/kit`](https://www.npmjs.com/package/@solana/kit)'s signer interfaces, so it plugs directly into kit's transaction pipeline (e.g. `signAndSendTransactionMessageWithSigners`):

```ts
import { solana } from "@kheopskit/core/solana";

const config = {
  // `chain` is the cluster the account signers target. Default: "solana:mainnet"
  platforms: [solana({ chain: "solana:mainnet" })],
  autoReconnect: true,
};

// account.signer is bound to the plugin's `chain`
const [signed] = await account.signer.modifyAndSignMessages([message]);

// account.getSigner(chain) returns a signer bound to another cluster
const devnetSigner = account.getSigner("solana:devnet");
```

- Supported `chain` values: `"solana:mainnet"`, `"solana:devnet"`, `"solana:testnet"`, `"solana:localnet"`
- `"solana:localnet"` cannot be used over WalletConnect (no canonical CAIP-2 id)

### Server-Side Rendering (SSR)

Kheopskit supports SSR with frameworks like Next.js and TanStack Start. Pass the `ssrCookies` prop to enable cookie-based storage that works on the server.

When you pass `ssrCookies`:
- Storage switches from localStorage to cookies
- Server can read initial state from request headers
- No hydration mismatch between server and client

#### Next.js (App Router)

`@kheopskit/react` ships with a `"use client"` directive, so you can import `KheopskitProvider` straight into a Server Component (like the root layout below) — no manual client-boundary wrapper needed.

```tsx
// app/layout.tsx
import { cookies } from "next/headers";
import { ethereum } from "@kheopskit/core/ethereum";
import { polkadot } from "@kheopskit/core/polkadot";
import { App } from "./app";

const config = {
  platforms: [polkadot(), ethereum()],
  autoReconnect: true,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const ssrCookies = cookieStore.toString();

  return (
    <html>
      <body>
        <KheopskitProvider config={config} ssrCookies={ssrCookies}>
          {children}
        </KheopskitProvider>
      </body>
    </html>
  );
}
```

#### TanStack Start

```tsx
// routes/__root.tsx
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { createServerFn, Meta, Scripts } from "@tanstack/start";
import { getRequest } from "@tanstack/start/server";
import { ethereum } from "@kheopskit/core/ethereum";
import { polkadot } from "@kheopskit/core/polkadot";
import { KheopskitProvider } from "@kheopskit/react";

const config = {
  platforms: [polkadot(), ethereum()],
  autoReconnect: true,
};

const getSSRCookies = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  return request?.headers.get("cookie") ?? undefined;
});

export const Route = createRootRoute({
  loader: async () => ({ ssrCookies: await getSSRCookies() }),
  component: RootComponent,
});

function RootComponent() {
  const { ssrCookies } = Route.useLoaderData();
  return (
    <html>
      <head><Meta /></head>
      <body>
        <KheopskitProvider config={config} ssrCookies={ssrCookies}>
          <Outlet />
        </KheopskitProvider>
        <Scripts />
      </body>
    </html>
  );
}
```

#### SSR Considerations

| Feature | Client-Only | SSR (with `ssrCookies`) |
|---------|-------------|-------------------------|
| Storage | localStorage | Cookies |
| Server access | ❌ | ✅ |
| Hydration match | ⚠️ Flash possible | ✅ No flash |
| Size limit | ~5MB | ~4KB |
| Cross-tab sync | `storage` event | BroadcastChannel |

**Cookie attributes**: Kheopskit uses `SameSite=Lax`, `Secure` (on HTTPS), `path=/`, and 1-year expiry.

**Cookie size limit (compact format)**: Cookie storage uses a compact JSON schema to stay under the ~4KB limit. As a rule of thumb, with 6 connected wallets you can fit about 30-40 accounts when most accounts do not include a name. If many accounts have names, expect closer to 25-30. When the cookie grows too large, browsers may reject it.
