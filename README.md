# Kheopskit

Kheopskit is a library designed to simplify the development of Polkadot DApps. It provides tools to:

- List all installed wallets and connect/disconnect them.
- List all accounts from those wallets.
- Support both Polkadot and Ethereum wallets.
- Handle identical accounts injected by multiple wallets.

Try it on the [interactive playground](https://Kheopskit.pages.dev/)

## Features

- **Multi-wallet support**: Easily interact with both Polkadot and Ethereum wallets.
- **Account management**: Manage accounts from all connected wallets in a single list.
- **Modern tech stack**: Designed for use with polkadot-api (PAPI) and viem.

---

## Installation

Install the required packages using `pnpm`:

```bash
pnpm add @kheopskit/core @kheopskit/react
```

---

## Usage

### With React

1. Import the required packages.
2. Wrap your app with `KheopskitProvider`.
3. Use the `useWallets` hook to access wallets and accounts.

```tsx
import React from "react";
import { KheopskitProvider, useWallets } from "@kheopskit/react";

const App = () => {
  const { wallets, accounts } = useWallets();

  return (
    <div>
      <h1>Wallets</h1>
      {wallets.map((wallet) => (
        <div key={wallet.id}>
          <div>
            [{wallet.platform}] {wallet.name}
          </div>
          {wallet.isConnected ? (
            <button onClick={wallet.disconnect}>Disconnect</button>
          ) : (
            <button onClick={wallet.connect}>Connect</button>
          )}
        </div>
      ))}

      <h1>Accounts</h1>
      {accounts.map((account) => (
        <div key={account.address}>
          <p>
            [{wallet.platform}] {account.name} (account.) - {account.address}
          </p>
        </div>
      ))}
    </div>
  );
};

const config = {
  platforms: ["polkadot", "ethereum"],
  autoReconnect: true,
};

const Root = () => (
  <KheopskitProvider config={config}>
    <App />
  </KheopskitProvider>
);

export default Root;
```

### With Vanilla JavaScript and RxJS

1. Instantiate a Kheopskit observable with `getKheopskit$(config)`.
2. Subscribe to the observable to access wallets and accounts.

```javascript
import { getKheopskit$ } from "@kheopskit/core";

const config = {
  platforms: ["polkadot", "ethereum"],
  autoReconnect: true,
};
const kheopskit$ = getKheopskit$(config);

kheopskit$.subscribe(({ wallets, accounts }) => {
  console.log("Wallets:", wallets);
  console.log("Accounts:", accounts);
});
```

### Server-Side Rendering (SSR)

Kheopskit supports SSR with frameworks like Next.js and TanStack Start. Pass the `ssrCookies` prop to enable cookie-based storage that works on the server.

When you pass `ssrCookies`:
- Storage switches from localStorage to cookies
- Server can read initial state from request headers
- No hydration mismatch between server and client

#### Next.js (App Router)

```tsx
// app/layout.tsx
import { cookies } from "next/headers";
import { Providers } from "./providers";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const ssrCookies = cookieStore.toString();

  return (
    <html>
      <body>
        <Providers ssrCookies={ssrCookies}>{children}</Providers>
      </body>
    </html>
  );
}
```

```tsx
// app/providers.tsx
"use client";

import { KheopskitProvider } from "@kheopskit/react";

const config = { platforms: ["polkadot", "ethereum"], autoReconnect: true };

export function Providers({ children, ssrCookies }: { children: React.ReactNode; ssrCookies?: string }) {
  return (
    <KheopskitProvider config={config} ssrCookies={ssrCookies}>
      {children}
    </KheopskitProvider>
  );
}
```

#### TanStack Start

```tsx
// routes/__root.tsx
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { createServerFn, Meta, Scripts } from "@tanstack/start";
import { getRequest } from "@tanstack/start/server";
import { Providers } from "../providers";

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
        <Providers ssrCookies={ssrCookies}><Outlet /></Providers>
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

---

## Roadmap

- [ ] Initial release with injected accounts support
- [ ] Support for WalletConnect
- [ ] UI components
- [ ] Documentation
