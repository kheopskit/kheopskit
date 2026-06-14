import type { KheopskitPlatform } from "@kheopskit/core";
import { useWallets } from "./useWallets";

/**
 * Convenience hook returning just the accounts from kheopskit state. Pass the
 * platform tuple as a type argument to recover SDK-precise account types —
 * `useAccounts<typeof platforms>()` — or use the pre-typed hook from
 * {@link createKheopskit}.
 */
export const useAccounts = <
	P extends readonly KheopskitPlatform[] = readonly KheopskitPlatform[],
>() => useWallets<P>().accounts;
