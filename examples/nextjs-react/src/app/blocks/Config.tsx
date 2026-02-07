"use client";

import type { WalletPlatform } from "@kheopskit/core";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { usePlaygroundConfig } from "@/lib/config/playgroundConfig";
import { AppBlock } from "./AppBlock";

export const Config = () => (
	<AppBlock title="Config" description="Set initialization parameters">
		<div className="flex flex-col gap-4">
			<Platforms />
			<AutoReconnect />
			<WalletConnect />
			<Reset />
		</div>
	</AppBlock>
);

const WalletConnect = () => {
	const { demoConfig, setWalletConnect } = usePlaygroundConfig();

	return (
		<div className="items-top flex space-x-2">
			<Checkbox
				id="walletConnect"
				checked={demoConfig.walletConnect}
				onCheckedChange={(checked) => {
					if (typeof checked !== "boolean") return;
					setWalletConnect(checked);
					window.location.reload();
				}}
			/>
			<div className="grid gap-1.5 leading-none">
				<label
					htmlFor="walletConnect"
					className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
				>
					WalletConnect
				</label>
				<p className="text-sm text-muted-foreground">
					Allows connecting with mobile wallets using QR codes
				</p>
			</div>
		</div>
	);
};

const AutoReconnect = () => {
	const { demoConfig, setAutoReconnect } = usePlaygroundConfig();

	return (
		<div className="items-top flex space-x-2">
			<Checkbox
				id="autoReconnect"
				checked={demoConfig.autoReconnect}
				onCheckedChange={(checked) => {
					if (typeof checked !== "boolean") return;
					setAutoReconnect(checked);
					window.location.reload();
				}}
			/>
			<div className="grid gap-1.5 leading-none">
				<label
					htmlFor="autoReconnect"
					className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
				>
					Auto reconnect
				</label>
				<p className="text-sm text-muted-foreground">
					Reconnects previously connected wallets on page reload
				</p>
			</div>
		</div>
	);
};

const PLATFORMS: Record<WalletPlatform, string> = {
	polkadot: "Polkadot (with PAPI)",
	ethereum: "Ethereum (with Viem or Wagmi)",
};

const Platforms = () => {
	const { demoConfig, setPlatformEnabled } = usePlaygroundConfig();

	return (
		<div className="items-top flex space-x-2">
			<div className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
				Platforms:
			</div>
			{Object.entries(PLATFORMS)
				.map((p) => p as [WalletPlatform, string])
				.map(([platform, label]) => (
					<div key={platform} className="flex items-center space-x-2">
						<Checkbox
							id={platform}
							checked={demoConfig.platforms?.includes(platform)}
							onCheckedChange={(checked) => {
								if (typeof checked !== "boolean") return;
								setPlatformEnabled(platform, checked);
								window.location.reload();
							}}
						/>
						<label
							htmlFor={platform}
							className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
						>
							{label}
						</label>
					</div>
				))}
		</div>
	);
};

const Reset = () => {
	const reset = useCallback(() => {
		localStorage.clear();
		window.location.reload();
	}, []);

	return (
		<div className="w-full text-right">
			<Button onClick={reset}>Reset to defaults</Button>
		</div>
	);
};
