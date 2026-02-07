"use client";

import { KheopskitProvider } from "@kheopskit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type FC, type PropsWithChildren } from "react";
import { WagmiProvider } from "wagmi";
import { Toaster } from "@/components/ui/sonner";
import { usePlaygroundConfig } from "@/lib/config/playgroundConfig";
import { wagmiConfig } from "@/lib/wagmi";

export const Providers: FC<PropsWithChildren<{ ssrCookies?: string }>> = ({
	children,
	ssrCookies,
}) => {
	const [queryClient] = useState(() => new QueryClient());
	// IMPORTANT on your app, kheopskit's config should be hardcoded
	const { kheopskitConfig: config } = usePlaygroundConfig();

	return (
		<KheopskitProvider config={config} ssrCookies={ssrCookies}>
			<WagmiProvider config={wagmiConfig}>
				<QueryClientProvider client={queryClient}>
					{children}
					<Toaster />
				</QueryClientProvider>
			</WagmiProvider>
		</KheopskitProvider>
	);
};
