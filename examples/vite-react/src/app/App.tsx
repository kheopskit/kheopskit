import { KheopskitProvider } from "@kheopskit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { GithubIcon } from "@/assets/GithubIcon";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { usePlaygroundConfig } from "@/lib/config/playgroundConfig";
import { wagmiConfig } from "@/lib/wagmi";
import { Accounts } from "./blocks/Accounts";
import { Config } from "./blocks/Config";
import { SubmitTx } from "./blocks/SubmitTx";
import { Wagmi } from "./blocks/Wagmi";
import { Wallets } from "./blocks/Wallets";

const queryClient = new QueryClient();

export const App = () => {
	// IMPORTANT on your app, kheopskit's config should be hardcoded
	const { kheopskitConfig: config } = usePlaygroundConfig();

	return (
		<KheopskitProvider config={config}>
			<WagmiProvider config={wagmiConfig}>
				<QueryClientProvider client={queryClient}>
					<AppContent />
					<Toaster />
				</QueryClientProvider>
			</WagmiProvider>
		</KheopskitProvider>
	);
};

const AppContent = () => (
	<div className="container mx-auto flex flex-col gap-8 items-center p-8 max-w-3xl">
		<div className="text-center space-y-2">
			<h1 className="text-3xl font-bold">Kheopskit Playground - Vite.js</h1>
			<div className="text-sm text-muted-foreground">
				Library for connecting dapps to multiple platforms & wallets
			</div>
		</div>
		<Config />
		<Wallets />
		<Accounts />
		<SubmitTx />
		<Wagmi />
		<Footer />
	</div>
);

const Footer = () => (
	<div>
		<Button asChild variant="ghost">
			<a href="https://github.com/kheopskit/kheopskit">
				<GithubIcon className="fill-white" />
				Github
			</a>
		</Button>
	</div>
);
