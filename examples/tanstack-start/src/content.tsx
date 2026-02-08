"use client";

import { GithubIcon } from "@/assets/GithubIcon";
import { Button } from "@/components/ui/button";
import { Accounts } from "./blocks/Accounts";
import { SubmitTx } from "./blocks/SubmitTx";
import { Wagmi } from "./blocks/Wagmi";
import { Wallets } from "./blocks/Wallets";

export const AppContent = () => (
	<div className="container mx-auto flex flex-col gap-8 items-center p-8 max-w-3xl">
		<div className="text-center space-y-2">
			<h1 className="text-3xl font-bold">Kheopskit Playground - Tanstack</h1>
			<div className="text-sm text-muted-foreground">
				Library for connecting dapps to multiple platforms & wallets
			</div>
		</div>
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
