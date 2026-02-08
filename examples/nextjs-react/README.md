# Kheopskit Next.js Example

A Next.js 15+ example demonstrating the usage of kheopskit - a multi-wallet connection library for Polkadot and Ethereum.

## Features

- Next.js 15+ with App Router
- React 19
- TypeScript
- Tailwind CSS v4
- SSR support with cookie-based hydration
- Multi-platform wallet support (Polkadot & Ethereum)

## Getting Started

1. Install dependencies from the workspace root:

```bash
pnpm install
```

2. Create a `.env.local` file with your WalletConnect project ID (optional, for WalletConnect support):

```bash
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=your_project_id_here
```

3. Run the development server:

```bash
pnpm --filter nextjs-react dev
```

The app will be available at [http://localhost:3002](http://localhost:3002).

## Build

```bash
pnpm --filter nextjs-react build
```

## Project Structure

- `src/app/` - Next.js App Router pages and layouts
- `src/app/blocks/` - Feature blocks (Accounts, Wallets, Config, etc.)
- `src/components/ui/` - Reusable UI components
- `src/lib/` - Utility functions and configuration
- `src/assets/` - Static assets and icons

## Key Differences from Vite Example

1. Uses `"use client"` directive for client components
2. Uses `process.env.NEXT_PUBLIC_*` instead of `import.meta.env.VITE_*`
3. SSR cookies passed from server layout to `KheopskitProvider`
4. SSR guards in `createStore.ts` for `window`/`localStorage` access
