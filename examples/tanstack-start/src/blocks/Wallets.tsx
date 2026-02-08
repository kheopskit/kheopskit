import { useWallets } from "@kheopskit/react";
import type { FC } from "react";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { AppBlock } from "./AppBlock";

/**
 * Wallet icon component that handles SSR hydration gracefully.
 * The container maintains stable size to prevent layout shift.
 * Icons fade in smoothly when they become available.
 */
const WalletIcon: FC<{
	icon: string;
	name?: string;
	className?: string;
}> = ({ icon, name, className }) => {
	// Container always takes up space to prevent layout shift
	// Icon fades in when available
	return (
		<div className={cn("size-6 inline-block shrink-0 relative", className)}>
			{icon && (
				<img src={icon} alt={name} className="size-6 absolute inset-0" />
			)}
		</div>
	);
};
export const Wallets = () => {
	const { wallets, accounts } = useWallets();

	return (
		<AppBlock
			title="Wallets"
			description="Lists all wallets installed on your browser"
			codeUrl="https://github.com/kheopskit/kheopskit/blob/main/examples/tanstack-start/src/blocks/Wallets.tsx"
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
								<div className="flex gap-2 items-center">
									<WalletIcon icon={wallet.icon} name={wallet.name} />
									<div>{wallet.name}</div>
								</div>
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
