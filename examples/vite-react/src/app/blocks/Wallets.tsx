import { type BaseWallet, isWalletConnectWallet } from "@kheopskit/core";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useWallets } from "@/lib/config/playgroundConfig";
import { AppBlock } from "./AppBlock";

const WalletButton = ({
	wallet,
}: {
	wallet: Pick<BaseWallet, "status" | "connect" | "disconnect">;
}) => {
	if (wallet.status === "connected")
		return (
			<Button className="w-28" onClick={() => wallet.disconnect()}>
				Disconnect
			</Button>
		);
	if (wallet.status === "connecting")
		return (
			<Button className="w-28" disabled>
				Connecting…
			</Button>
		);
	return (
		<Button className="w-28" onClick={() => wallet.connect()}>
			Connect
		</Button>
	);
};

export const Wallets = () => {
	const { wallets, accounts, isDiscovering } = useWallets();

	return (
		<AppBlock
			title="Wallets"
			description="Lists all wallets installed on your browser"
			codeUrl="https://github.com/kheopskit/kheopskit/blob/main/examples/vite-react/src/app/blocks/Wallets.tsx"
		>
			{isDiscovering && (
				<p className="text-sm text-muted-foreground">Looking for wallets…</p>
			)}
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Platform</TableHead>
						<TableHead>Wallet</TableHead>
						<TableHead className="text-right w-1/3">Accounts</TableHead>
						<TableHead className="text-right w-1/3"> </TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{wallets.map((wallet) => (
						<TableRow key={wallet.id}>
							<TableCell>
								{isWalletConnectWallet(wallet)
									? wallet.platforms.join(", ") || "—"
									: wallet.platform}
							</TableCell>
							<TableCell>
								{wallet.icon ? (
									<img
										src={wallet.icon}
										alt={wallet.name}
										className="w-6 h-6 mr-2 inline shrink-0"
									/>
								) : (
									<div className="w-6 h-6 mr-2 inline-block shrink-0"></div>
								)}
								{wallet.name}
								{wallet.error && (
									<div className="text-xs text-destructive">
										{wallet.error.message}
									</div>
								)}
							</TableCell>
							<TableCell className="text-right">
								{accounts.filter((a) => a.walletId === wallet.id).length}
							</TableCell>
							<TableCell className="text-right">
								<WalletButton wallet={wallet} />
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</AppBlock>
	);
};
