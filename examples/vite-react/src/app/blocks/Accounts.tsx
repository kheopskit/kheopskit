import { createSignableMessage, getBase58Decoder } from "@solana/kit";
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
import { useWallets, type WalletAccount } from "@/lib/config/playgroundConfig";
import { shortenAddress } from "@/lib/shortenAddress";
import { AppBlock } from "./AppBlock";

export const Accounts = () => {
	const { accounts } = useWallets();

	return (
		<AppBlock
			title="Accounts"
			description="Lists all connected accounts"
			codeUrl="https://github.com/kheopskit/kheopskit/blob/main/examples/vite-react/src/app/blocks/Accounts.tsx"
		>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Platform</TableHead>
						<TableHead>Wallet</TableHead>
						<TableHead className="w-1/3">Name</TableHead>
						<TableHead className="w-1/3">Address</TableHead>
						<TableHead>Chain ID</TableHead>
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
			<TableCell>{account.name}</TableCell>
			<TableCell className="font-mono">{shortAddress}</TableCell>
			<TableCell>
				{account.platform === "ethereum" ? (account.chainId ?? "-") : "-"}
			</TableCell>
			<TableCell className="space-x-2 font-mono">
				<SignButton account={account} />
				{account.platform === "polkadot" ? (
					<SignInButton account={account} />
				) : null}
			</TableCell>
		</TableRow>
	);
};

const SignButton: FC<{ account: WalletAccount }> = ({ account }) => {
	const { isHydrating } = useWallets();
	const MESSAGE = "Kheopskit rocks!";

	const handleClick = useCallback(async () => {
		if (account.isPlaceholder) return;
		switch (account.platform) {
			case "polkadot": {
				const bytes = Binary.fromText(MESSAGE);
				try {
					const signature = await account.txCreator.signBytes(bytes);
					const hexSignature = Binary.toHex(signature);
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

			case "solana": {
				try {
					const [signed] = await account.signer.modifyAndSignMessages([
						createSignableMessage(MESSAGE),
					]);
					// the signer adds exactly one signature (for this account)
					const [signatureBytes] = Object.values(signed?.signatures ?? {});
					const signature = signatureBytes
						? getBase58Decoder().decode(signatureBytes)
						: "";
					toast.success(`Signature: ${signature}`);
				} catch (err) {
					toast.error(`Error: ${(err as Error).message}`);
				}
				break;
			}
		}
	}, [account]);

	return (
		<Button onClick={handleClick} disabled={isHydrating}>
			Sign
		</Button>
	);
};

const SignInButton: FC<{
	account: Extract<WalletAccount, { platform: "polkadot" }>;
}> = ({ account }) => {
	const { isHydrating } = useWallets();

	const handleClick = useCallback(async () => {
		if (account.isPlaceholder) return;
		const message = [
			`${window.location.host} wants you to sign in with your Substrate account:`,
			account.address,
			"",
			"Kheopskit sign-in",
			"",
			`URI: ${window.location.origin}`,
			"Version: 1.0.0",
			`Nonce: ${crypto.randomUUID()}`,
			`Issued At: ${new Date().toISOString()}`,
		].join("\n");
		try {
			const signature = await account.signRaw(message);
			toast.success(`Signature: ${signature}`);
		} catch (err) {
			toast.error(`Error: ${(err as Error).message}`);
		}
	}, [account]);

	return (
		<Button onClick={handleClick} disabled={isHydrating}>
			Sign in
		</Button>
	);
};
