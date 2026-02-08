import { useWallets } from "@kheopskit/react";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { AppBlock } from "./AppBlock";

export const Wallets = () => {
	const { wallets, accounts } = useWallets();

	return (
		<AppBlock
			title="Wallets"
			description="Lists all wallets installed on your browser"
			codeUrl="https://github.com/kheopskit/kheopskit/blob/main/examples/vite-react/src/app/blocks/Wallets.tsx"
		>
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
							<TableCell>{wallet.platform}</TableCell>
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
							</TableCell>
							<TableCell className="text-right">
								{accounts.filter((a) => a.walletId === wallet.id).length}
							</TableCell>
							<TableCell className="text-right">
								{wallet.isConnected ? (
									<Button className="w-28" onClick={wallet.disconnect}>
										Disconnect
									</Button>
								) : (
									<Button className="w-28" onClick={wallet.connect}>
										Connect
									</Button>
								)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</AppBlock>
	);
};
