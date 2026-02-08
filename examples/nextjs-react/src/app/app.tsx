"use client";

import type { KheopskitConfig } from "@kheopskit/core";
import { KheopskitProvider } from "@kheopskit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type FC, type PropsWithChildren, useState } from "react";
import { WagmiProvider } from "wagmi";
import { Toaster } from "@/components/ui/sonner";
import { APPKIT_CHAINS } from "@/lib/config/chains";
import { wagmiConfig } from "@/lib/wagmi";

// Hardcoded config - IMPORTANT: dynamic config (from localStorage) causes SSR hydration mismatch
const kheopskitConfig: Partial<KheopskitConfig> = {
	autoReconnect: true,
	platforms: ["polkadot", "ethereum"],
	walletConnect: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID
		? {
				projectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID,
				metadata: {
					name: "Kheopskit Demo",
					description: "Kheopskit Demo",
					url: typeof window !== "undefined" ? window.location.origin : "",
					icons: [],
				},
				networks: APPKIT_CHAINS,
			}
		: undefined,
	debug: true,
	storageKey: "kheopskit",
};

export const App: FC<PropsWithChildren<{ ssrCookies?: string }>> = ({
	children,
	ssrCookies,
}) => {
	const [queryClient] = useState(() => new QueryClient());

	return (
		<KheopskitProvider config={kheopskitConfig} ssrCookies={ssrCookies}>
			<WagmiProvider config={wagmiConfig}>
				<QueryClientProvider client={queryClient}>
					{children}
					<Toaster />
				</QueryClientProvider>
			</WagmiProvider>
		</KheopskitProvider>
	);
};
