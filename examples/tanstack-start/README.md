# Kheopskit - TanStack Start Example

> **⚠️ Work in Progress**: This example is under development. TanStack Start is evolving rapidly and there may be version compatibility issues.

This example demonstrates how to use [Kheopskit](https://github.com/kheopskit/kheopskit) with TanStack Start for server-side rendering.

## Features

- TanStack Start with React 19
- TypeScript
- Tailwind CSS v4 (using @tailwindcss/vite)
- SSR support with cookie-based state hydration
- Multi-wallet connection for Polkadot and Ethereum

## Getting Started

1. Install dependencies:

```bash
pnpm install
```

2. Copy the environment file and add your WalletConnect Project ID:

```bash
cp .env.example .env
```

3. Start the development server:

```bash
pnpm dev
```

The app will be running at [http://localhost:3003](http://localhost:3003).

## Known Issues

The TanStack Start ecosystem is rapidly evolving, and version compatibility can be challenging. If you encounter issues:

- Ensure all `@tanstack/*` packages are using compatible versions
- Check the [TanStack Start documentation](https://tanstack.com/start) for the latest setup instructions

## Project Structure

```
src/
├── routes/           # TanStack Start file-based routing
│   ├── __root.tsx    # Root layout with providers
│   └── index.tsx     # Home page
├── blocks/           # Feature components
├── components/ui/    # Reusable UI components
├── lib/              # Utilities and config
│   └── config/       # Kheopskit configuration
├── assets/           # Static assets
├── providers.tsx     # App providers (Kheopskit, Wagmi, Query)
├── content.tsx       # Main app content
└── styles.css        # Global styles with Tailwind
```

## SSR Support

This example demonstrates proper SSR support for Kheopskit:

1. Cookies are read on the server using `createServerFn` in the root route
2. Cookies are passed to the `KheopskitProvider` via `ssrCookies` prop
3. The `createStore` utility includes SSR guards for `window` and `localStorage` access

## Learn More

- [Kheopskit Documentation](https://github.com/kheopskit/kheopskit)
- [TanStack Start Documentation](https://tanstack.com/start)
- [Wagmi Documentation](https://wagmi.sh)
