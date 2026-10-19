# @kheopskit/react

React bindings for [Kheopskit](https://github.com/kheopskit/kheopskit). They
list wallets and accounts across Polkadot, Ethereum and Solana, with injected wallets
and WalletConnect (Reown AppKit).

The framework-agnostic core lives in
[`@kheopskit/core`](https://www.npmjs.com/package/@kheopskit/core).
Full docs and the interactive playground:
https://github.com/kheopskit/kheopskit

> **Upgrading from v3?** v4 moves platforms to plugins and makes platform SDKs
> (and WalletConnect) optional peer dependencies. See
> [MIGRATING_TO_V4.md](../core/MIGRATING_TO_V4.md).

> **Upgrading from v5?** v6 makes `connect()` shared, idempotent and
> abortable, types its rejections, adds `status`, `isDiscovering`,
> `isPlaceholder` and `signRaw`, and moves WalletConnect to a plugin. See
> [MIGRATING_TO_V6.md](https://github.com/kheopskit/kheopskit/blob/main/packages/core/MIGRATING_TO_V6.md).
> The [core README](https://github.com/kheopskit/kheopskit/blob/main/packages/core/README.md#wallet-lifecycle)
> explains the wallet lifecycle that `useWallets()` reflects.

## Install

`rxjs` is always required. Every platform SDK (and WalletConnect) is an
optional peer dependency, so install only what you use:

```bash
pnpm add @kheopskit/core @kheopskit/react rxjs

pnpm add polkadot-api                                            # Polkadot
pnpm add viem mipd                                               # Ethereum
pnpm add @solana/kit @wallet-standard/app @wallet-standard/base  # Solana
pnpm add @reown/appkit                                           # WalletConnect (optional)
```

WalletConnect is a plugin from `@kheopskit/core/walletconnect`; only a dapp that
imports it bundles AppKit:

```ts
import { createKheopskit } from "@kheopskit/react";
import { polkadot } from "@kheopskit/core/polkadot";
import { walletConnect } from "@kheopskit/core/walletconnect";
import { defineChain } from "@reown/appkit/networks";

const polkadotNetwork = defineChain({
  id: "91b171bb158e2d3848fa23a9f1c25182",
  name: "Polkadot",
  nativeCurrency: { name: "Polkadot", symbol: "DOT", decimals: 10 },
  rpcUrls: { default: { http: ["https://rpc.polkadot.io"] } },
  chainNamespace: "polkadot",
  caipNetworkId: "polkadot:91b171bb158e2d3848fa23a9f1c25182",
});

export const { KheopskitProvider, useWallets, useAccounts } = createKheopskit({
  platforms: [polkadot()],
  walletConnect: walletConnect({
    projectId: "<your Reown project id>",
    metadata: { name: "My Dapp", description: "", url: "https://my.dapp", icons: [] },
    networks: [polkadotNetwork],
  }),
});
```

## Usage

Recommended: bind your platform tuple once with `createKheopskit` and get a
provider plus hooks already typed to those platforms, with no generic to repeat.

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

Every account has an optional `name`, so `account.name || account.address`
typechecks on the whole union. Polkadot accounts get the name the extension
lists. Solana accounts get the wallet's `label` when it provides one. Ethereum
accounts never have a name. A wallet can report an empty name, which `||`
replaces with the address.

### Without the factory

You can also use the `KheopskitProvider` component directly and recover precise
types with a type argument (React context can't be generic):

```tsx
import { KheopskitProvider, useWallets } from "@kheopskit/react";

const platforms = [polkadot(), ethereum(), solana()] as const;

<KheopskitProvider config={{ platforms }}>…</KheopskitProvider>;

const { accounts } = useWallets<typeof platforms>();
```

## Hooks

| Hook | Returns | Re-renders |
|------|---------|------------|
| `useWallets()` | the whole state: `wallets`, `accounts`, `config`, `isHydrating`, `isDiscovering` | on every state change |
| `useAccounts()` | `useWallets().accounts` | on every state change |
| `useWallet(walletId)` | the wallet with this id, or `undefined` | when that wallet changes |
| `useAccount(accountId)` | the account with this id, or `undefined` | when that account changes |
| `useConnect(walletId)` | `{ connect, disconnect, status, error }` for one wallet | when that wallet changes |

`useWallet` and `useAccount` compare the item's fields, SDK handles by identity
and any two functions as equal. Another wallet connecting does not re-render
them.

A connect button with `useConnect`:

```tsx
import type { WalletId } from "@kheopskit/core";
import { useConnect } from "@kheopskit/react";

const ConnectButton = ({ walletId }: { walletId: WalletId }) => {
  const { connect, disconnect, status, error } = useConnect(walletId);
  if (status === "connected") return <button onClick={disconnect}>Disconnect</button>;
  return (
    <>
      <button disabled={status === "connecting"} onClick={connect}>
        Connect
      </button>
      {error?.code === "USER_REJECTED" && <p>You refused the connection.</p>}
    </>
  );
};
```

- `connect()` resolves once the state shows the wallet connected.
- If the component unmounts or `walletId` changes while `connect()` waits for
  the extension, the hook aborts the connect. The wallet stays disconnected
  and is not remembered, and `connect()` resolves.
- A `connect()` that starts after the component unmounted, such as from an
  async handler that resumes later, or through a `connect` captured before
  `walletId` changed, rejects `ABORTED` without asking the extension.
- A Suspense fallback shown over the component, or a StrictMode remount, aborts
  nothing. Only a real unmount, an `<Activity>` hide or a `walletId` change
  does.
- Every other failure rejects with the wallet's `KheopskitError`, such as
  `USER_REJECTED`, and also shows in `error`. When the state lists no wallet
  with this id, `connect` rejects with a plain `Error`.
- `connect` and `disconnect` keep their identity while `walletId` stays the
  same. A `useEffect(() => { connect() }, [connect])` connects on mount and
  again after every `<Activity>` reveal.

Every action a hook hands out acts on the instance's pipeline when it is
called: `connect` and `disconnect` from `useConnect`, from a `useWallet` wallet
and from a `useWallets()` wallet. The pipeline runs while anything holds it: a
mounted and visible provider of the instance, or a subscriber of its
`kheopskit$`. A wallet's `connect` or `disconnect`, and `useConnect`'s
`disconnect`, act on it while anything holds it, also after the provider that
handed them out unmounted or was hidden. Once the last holder leaves, the
pipeline stops; an action called then rejects `ABORTED` and starts no pipeline.
An `<Activity>` hide of the only provider stops the pipeline and a reveal
restarts it. An action called in between, from a layout effect, a mount effect
or a click during the reveal, waits for the restarted pipeline's first emission
and then acts on the live wallet. When the live state lists no wallet with the
action's id, the action rejects with a plain `Error`, not a `KheopskitError`.
An action pending when the pipeline stops
with an error or completes rejects `ABORTED` with that reason. Account actions
such as `signRaw` bind to the extension, not to the pipeline, and work either
way. Only `useConnect`'s `connect` is scoped to its component, as described
above.

The hooks from `createKheopskit` are typed to its platforms. Standalone, pass the
platform tuple: `useWallet<typeof platforms>(walletId)`. `useConnect` is the
same for every platform.

## One instance for React and RxJS code

`createKheopskit` also returns `kheopskit$`, the state stream its provider
subscribes to, and `store`, the store that stream persists into. Code outside
React, such as an RxJS pipeline or a sign-in flow, subscribes to the same
`kheopskit$`. While the provider is mounted, both share one pipeline: one wallet
discovery, one reconnect attempt and one extension prompt.

```ts
// kheopskit.ts
export const { KheopskitProvider, useWallets, useWallet, kheopskit$, store } =
  createKheopskit({ platforms: [polkadot()] });
```

```ts
// session.ts
import { distinctUntilChanged, map } from "rxjs";
import { kheopskit$ } from "./kheopskit";

export const addresses$ = kheopskit$.pipe(
  map(({ accounts }) =>
    accounts.filter((account) => !account.isPlaceholder).map((account) => account.address),
  ),
  distinctUntilChanged((a, b) => a.join() === b.join()),
);
```

`kheopskit$` starts with its first subscriber and stops when the last one
leaves. The mounted provider counts as a subscriber. The provider never runs it
on the server. It renders each server request from that request's
`ssrCookies`. A module-level subscription in code the server evaluates does run
it there. It emits one state without wallets, persists nothing, leaves no timer
behind and does not change what the provider renders for a request.

Without `options.store`, `createKheopskit` creates the store on first use in
the browser. The provider claims it when it first renders there. The store is
backed by cookies when the provider renders with `ssrCookies`, and by
localStorage otherwise. Effects of components inside the provider run after
that render, so they use the provider's store. In an SSR app, code that reads
`store` or subscribes to `kheopskit$` before the provider renders, such as
module-scope code or a parent's effect that runs before the provider mounts,
would get the localStorage store. Pass the store in that case:

```ts
import { createKheopskitStore } from "@kheopskit/core";

export const { KheopskitProvider, kheopskit$, store } = createKheopskit(config, {
  store: createKheopskitStore({ ssrCookies: "" }),
});
```

`createKheopskit` never calls `store.destroy()`, so the store survives a
provider remount. Call it yourself when the app no longer needs kheopskit.

## SSR

Pass the `kheopskit` cookie as `ssrCookies` to hydrate wallet state on the
server without a UI flash. Never forward the whole cookie header to a client
component: the framework serializes its props into the HTML, httpOnly session
cookies included.

```tsx
// Next.js App Router
const kheopskitCookie = (await cookies()).get("kheopskit");
const ssrCookies = kheopskitCookie
  ? `kheopskit=${encodeURIComponent(kheopskitCookie.value)}`
  : "";

<KheopskitProvider ssrCookies={ssrCookies}>{children}</KheopskitProvider>;
```

Kheopskit reads one cookie, named after the `storageKey` config option
(default `kheopskit`). Pass `""` when it is absent, because without
`ssrCookies` the browser persists to `localStorage` instead of the cookie. The
[TanStack Start example](https://github.com/kheopskit/kheopskit/blob/main/examples/tanstack-start/src/routes/__root.tsx)
reads it with `getCookie("kheopskit")` in a server function.

> While `state.isHydrating` is `true`, wallets and accounts restored from the
> cache are placeholders with `isPlaceholder: true` and no SDK handle
> (`txCreator`, `signer`, `client`, `provider`, `extension`). Narrow on
> `isPlaceholder` before you read one, as in `if (account.isPlaceholder) return;`.
> `isHydrating` can still disable a button.

## Testing

Render the real provider with a store backed by memory and a fake extension from
[`@kheopskit/core/testing`](../core/README.md#testing):

```tsx
import { createKheopskitStore, type KheopskitStore } from "@kheopskit/core";
import { polkadot } from "@kheopskit/core/polkadot";
import {
  createFakePolkadotExtension,
  createMemoryStorage,
  type FakePolkadotExtension,
} from "@kheopskit/core/testing";
import { createKheopskit, useConnect } from "@kheopskit/react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let talisman: FakePolkadotExtension;
let store: KheopskitStore;

beforeEach(() => {
  vi.useFakeTimers();
  talisman = createFakePolkadotExtension({ name: "talisman" });
  store = createKheopskitStore({ storage: createMemoryStorage() });
});

afterEach(() => {
  cleanup();
  talisman.uninstall();
  store.destroy();
  vi.useRealTimers();
});

const ConnectButton = () => {
  const { connect, status } = useConnect("polkadot:talisman");
  return (
    <button type="button" onClick={connect}>
      {status}
    </button>
  );
};

it("connects the wallet the user picks", async () => {
  const { KheopskitProvider } = createKheopskit({ platforms: [polkadot()] }, { store });
  render(
    <KheopskitProvider>
      <ConnectButton />
    </KheopskitProvider>,
  );
  await act(() => vi.advanceTimersByTimeAsync(1000));

  fireEvent.click(screen.getByRole("button"));
  await act(() => vi.advanceTimersByTimeAsync(1000));

  expect(screen.getByRole("button").textContent).toBe("connected");
  expect(talisman.enableCalls()).toHaveLength(1);
});
```

The `afterEach` is the whole teardown. `cleanup()` unmounts the provider, which
stops kheopskit's timers, `uninstall()` removes the fake, and `destroy()` ends
the store's storage subscription. The standalone `KheopskitProvider` takes the
same store as a `store` prop.

## License

ISC
