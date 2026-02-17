# Copilot Instructions

## Browser Testing with Chrome DevTools MCP

When testing the app using Chrome DevTools MCP (browser automation):

1. **Check if a dev server is already running** before starting a new one. Use `lsof -i :PORT` or check running terminals.

2. **NEVER spawn a duplicate dev server.** Starting a second instance will use a different port (e.g., 3004 instead of 3003), and browser extensions/wallets are only injected on the original URL. Testing on the wrong port makes automated wallet testing impossible.

3. **To restart for clean state:** Kill the existing server first, then start a new one on the same port:
   ```bash
   pkill -f "vite dev --port" && pnpm dev:tanstack
   ```

4. **Preferred ports:**
   - TanStack Start: 3003
   - Next.js: 3000
   - Vite React: 5173

## Project Structure

- `packages/core` - Core library with RxJS observables for wallet state
- `packages/react` - React bindings (KheopskitProvider, hooks)
- `examples/tanstack-start` - TanStack Start SSR playground
- `examples/nextjs-react` - Next.js SSR playground  
- `examples/vite-react` - Vite client-only playground

## SSR Hydration

For SSR apps (TanStack Start, Next.js):
- Config must be **hardcoded** (not from localStorage) to avoid server/client mismatch
- Wallet icons are NOT stored in cookies to reduce size - they're looked up at hydration time
- Pass `ssrCookies` prop to `KheopskitProvider` for state hydration

## Testing

```bash
pnpm test          # Run all tests
pnpm dev:tanstack  # Start TanStack playground
pnpm dev:nextjs    # Start Next.js playground
pnpm dev:vite      # Start Vite playground
```

When changing behavior or public API, add or update relevant tests in the same task.
At minimum, include one happy-path test and one regression/edge-case test for the changed logic.

## Task Completion Quality Gate

Before finishing any coding task, always run this full quality check sequence:

```bash
pnpm check --fix --error-on-warnings && pnpm typecheck && pnpm test
```
