# Kheopskit

**Headless wallet connection for Polkadot, Ethereum and Solana dapps.**

Kheopskit finds every wallet installed in the browser, connects it, and gives you one typed list of accounts across three chains. It renders nothing. You keep your own UI.

[![npm](https://img.shields.io/npm/v/@kheopskit/core?label=%40kheopskit%2Fcore)](https://www.npmjs.com/package/@kheopskit/core)
[![npm](https://img.shields.io/npm/v/@kheopskit/react?label=%40kheopskit%2Freact)](https://www.npmjs.com/package/@kheopskit/react)

[Playground](https://kheopskit.pages.dev/) · [Core docs](./packages/core/README.md) · [React docs](./packages/react/README.md) · [Upgrade to v6](./packages/core/MIGRATING_TO_V6.md)

## Why kheopskit

- **Headless.** No components and no CSS. You get a state object and `connect()` and `disconnect()`, and your design system draws the buttons.
- **One list for three chains.** Polkadot extensions, EIP-6963 Ethereum wallets, Wallet Standard Solana wallets and WalletConnect land in one `wallets` array and one `accounts` array.
- **Native SDKs.** Accounts carry a polkadot-api `txCreator`, a viem `client` or a `@solana/kit` signer. There is no wrapper API to learn.
- **Bundle only what you import.** Each platform is a plugin with its own entry point, and every chain SDK is an optional peer dependency. A Polkadot-only dapp bundles no viem, Solana or AppKit code.
- **No flicker on page load.** Kheopskit caches the wallet and account lists, so the first frame already shows the user's accounts while connected wallets reconnect in the background without a prompt. With SSR cookies, Next.js and TanStack Start pages render those accounts on the server.
- **Built-in WalletConnect.** Add the `walletConnect()` plugin and mobile wallets pair through Reown AppKit, in one session for every network you list. Their accounts land in the same `accounts` array as injected ones.
- **Typed errors.** `connect()` rejects with a `KheopskitError` whose `code` you can switch on: `USER_REJECTED`, `ABORTED`, `CONNECT_FAILED`, and more.
- **Ready for coding agents.** Types and error codes are explicit, the docs ship inside the npm package, and a fake extension lets an agent test its integration in vitest without a real wallet.

## Install

```bash
pnpm add @kheopskit/core @kheopskit/react rxjs
```

Add the SDKs of the platforms you enable:

| Platform | Plugin entry point | Install |
|----------|--------------------|---------|
| Polkadot | `@kheopskit/core/polkadot` | `pnpm add polkadot-api` |
| Ethereum | `@kheopskit/core/ethereum` | `pnpm add viem mipd` |
| Solana | `@kheopskit/core/solana` | `pnpm add @solana/kit @wallet-standard/app @wallet-standard/base` |
| WalletConnect | `@kheopskit/core/walletconnect` | `pnpm add @reown/appkit` |

## Quick start with React

Bind your platforms once with `createKheopskit`. The hooks it returns are typed to those platforms.

```tsx
// kheopskit.ts
import { createKheopskit } from "@kheopskit/react";
import { polkadot } from "@kheopskit/core/polkadot";
import { ethereum } from "@kheopskit/core/ethereum";

export const { KheopskitProvider, useWallets } = createKheopskit({
	platforms: [polkadot(), ethereum()],
	autoReconnect: true,
});
```

```tsx
// app.tsx
import { KheopskitProvider, useWallets } from "./kheopskit";

const Wallets = () => {
	const { wallets, accounts } = useWallets();

	return (
		<>
			{wallets.map((wallet) => (
				<button
					key={wallet.id}
					disabled={wallet.status === "connecting"}
					onClick={() => (wallet.isConnected ? wallet.disconnect() : wallet.connect())}
				>
					{wallet.isConnected ? "Disconnect" : "Connect"} {wallet.name}
				</button>
			))}
			{accounts.map((account) => (
				<p key={account.id}>
					[{account.platform}] {account.name ?? account.address}
				</p>
			))}
		</>
	);
};

export const App = () => (
	<KheopskitProvider>
		<Wallets />
	</KheopskitProvider>
);
```

## Quick start without React

`getKheopskit$` returns an RxJS observable of the same state, for any framework or none.

```ts
import { getKheopskit$ } from "@kheopskit/core";
import { solana } from "@kheopskit/core/solana";

getKheopskit$({ platforms: [solana()], autoReconnect: true }).subscribe(
	({ wallets, accounts }) => console.log(wallets, accounts),
);
```

## Rules that prevent the common bugs

- Wait for `isDiscovering` to be `false` before you tell the user a wallet is missing.
- Check `!account.isPlaceholder` before you sign. Accounts restored from the cache have no SDK handle until reconnect ends.
- Branch on `error.code`, not on the error message.
- Pass a config that keeps the same reference across renders. `createKheopskit` does this for you.

## Docs

| To do this | Read |
|------------|------|
| Use one wallet or account in a component (`useWallet`, `useAccount`, `useConnect`) | [React hooks](./packages/react/README.md#hooks) |
| Understand discovery, hydration and reconnect timings | [Wallet lifecycle](./packages/core/README.md#wallet-lifecycle) |
| Handle `connect()` errors | [Connect and disconnect](./packages/core/README.md#connect-and-disconnect) |
| Sign transactions and raw messages | [Signing](./packages/core/README.md#signing) |
| Add WalletConnect | [Core install](./packages/core/README.md#install) |
| Render on the server | [React SSR](./packages/react/README.md#ssr), [Next.js example](./examples/nextjs-react), [TanStack Start example](./examples/tanstack-start) |
| Test your integration | [Core testing](./packages/core/README.md#testing), [React testing](./packages/react/README.md#testing) |
| Upgrade | [v5 to v6](./packages/core/MIGRATING_TO_V6.md), [v3 to v4](./packages/core/MIGRATING_TO_V4.md) |

## For AI coding agents

Read the docs from `node_modules`, because they match the installed version:

- `node_modules/@kheopskit/core/README.md` covers state, lifecycle, errors, signing and test helpers.
- `node_modules/@kheopskit/react/README.md` covers the provider and hooks.
- `node_modules/@kheopskit/core/MIGRATING_TO_V6.md` lists every v6 change, with before and after code.

To check your work, render the real provider with `createFakePolkadotExtension` and `createMemoryStorage` from `@kheopskit/core/testing`.

## Built with kheopskit

- [Kheopswap](https://github.com/kheopswap/kheopswap) for Polkadot and Ethereum
- [Taohop](https://github.com/0xKheops/taohop)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Kheopskit is ISC licensed.
