"use client";

import { KheopskitProvider } from "@kheopskit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type FC, type PropsWithChildren, useState } from "react";
import { WagmiProvider } from "wagmi";
import { Toaster } from "@/components/ui/sonner";
import { wagmiConfig } from "@/lib/wagmi";
import { kheopskitConfig } from "./lib/config/playgroundConfig";

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
