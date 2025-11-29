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

---

## Roadmap

- [ ] Initial release with injected accounts support
- [ ] Support for WalletConnect
- [ ] UI components
- [ ] Documentation
