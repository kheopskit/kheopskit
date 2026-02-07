import type { WalletAccount } from "@kheopskit/core";
import { useWallets } from "@kheopskit/react";
import { Binary } from "polkadot-api";
import { type FC, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { shortenAddress } from "@/lib/shortenAddress";
import { AppBlock } from "./AppBlock";

export const Accounts = () => {
	const { accounts } = useWallets();

	return (
		<AppBlock
			title="Accounts"
			description="Lists all connected accounts"
			codeUrl="https://github.com/kheopskit/kheopskit/blob/main/examples/tanstack-start/src/blocks/Accounts.tsx"
		>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Platform</TableHead>
						<TableHead>Wallet</TableHead>
						<TableHead className="w-1/3">Name</TableHead>
						<TableHead className="w-1/3">Address</TableHead>
						<TableHead> </TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{accounts.map((account) => (
						<AccountRow key={account.id} account={account} />
					))}
				</TableBody>
			</Table>
		</AppBlock>
	);
};

const AccountRow: FC<{ account: WalletAccount }> = ({ account }) => {
	const { platform, walletName, address } = account;

	const shortAddress = useMemo(() => shortenAddress(address), [address]);

	return (
		<TableRow key={account.id}>
			<TableCell>{platform}</TableCell>
			<TableCell>{walletName}</TableCell>
			<TableCell>
				{account.platform === "polkadot" ? account.name : null}
			</TableCell>
			<TableCell className="font-mono">{shortAddress}</TableCell>
			<TableCell className="font-mono">
				<SignButton account={account} />
			</TableCell>
		</TableRow>
	);
};

const SignButton: FC<{ account: WalletAccount }> = ({ account }) => {
	const MESSAGE = "Kheopskit rocks!";

	const handleClick = useCallback(async () => {
		switch (account.platform) {
			case "polkadot": {
				const bytes = Binary.fromText(MESSAGE).asBytes();
				try {
					const signature = await account.polkadotSigner.signBytes(bytes);
					const hexSignature = Binary.fromBytes(signature).asHex();
					toast.success(`Signature: ${hexSignature}`);
				} catch (err) {
					toast.error(`Error: ${(err as Error).message}`);
				}
				break;
			}

			case "ethereum": {
				try {
					const signature = await account.client.signMessage({
						message: MESSAGE,
						account: account.address,
					});
					toast.success(`Signature: ${signature}`);
				} catch (err) {
					toast.error(`Error: ${(err as Error).message}`);
				}
				break;
			}
		}
	}, [account]);

	return <Button onClick={handleClick}>Sign</Button>;
};
