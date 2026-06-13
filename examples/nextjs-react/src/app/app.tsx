"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type FC, type PropsWithChildren, useState } from "react";
import { WagmiProvider } from "wagmi";
import { Toaster } from "@/components/ui/sonner";
import { KheopskitProvider } from "@/lib/config/playgroundConfig";
import { wagmiConfig } from "@/lib/wagmi";

export const App: FC<PropsWithChildren<{ ssrCookies?: string }>> = ({
	children,
	ssrCookies,
}) => {
	const [queryClient] = useState(() => new QueryClient());

	return (
		<KheopskitProvider ssrCookies={ssrCookies}>
			<WagmiProvider config={wagmiConfig}>
				<QueryClientProvider client={queryClient}>
					{children}
					<Toaster />
				</QueryClientProvider>
			</WagmiProvider>
		</KheopskitProvider>
	);
};
