import type {
	EthereumAccount,
	PolkadotAccount,
	WalletAccount,
} from "@kheopskit/core";
import { useWallets } from "@kheopskit/react";
import { MultiAddress } from "@polkadot-api/descriptors";
import type { TxEvent } from "polkadot-api";
import { type FC, useEffect, useMemo, useState } from "react";
import type { Observable } from "rxjs";
import { toast } from "sonner";
import { createPublicClient, http, isHex, type RpcError } from "viem";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	APPKIT_CHAIN_ID_TO_DOT_CHAIN_ID,
	APPKIT_CHAINS,
	isEthereumNetwork,
	isPolkadotNetwork,
	VIEM_CHAINS_BY_ID,
} from "@/lib/config/chains";
import { getPolkadotApi, type PolkadotChainId } from "@/lib/getPolkadotApi";
import { AppBlock } from "./AppBlock";

export const SubmitTx = () => (
	<AppBlock
		title="Submitting a transaction"
		description={
			"Demo transfer: selected account will send 0 tokens on selected network"
		}
		codeUrl="https://github.com/kheopskit/kheopskit/blob/main/examples/vite-react/src/app/blocks/SubmitTx.tsx"
	>
		<div className="flex flex-col gap-8">
			<Content />
		</div>
	</AppBlock>
);

const Content = () => {
	const defaultNetworkId = useDefaultNetworkId();
	const [networkId, setNetworkId] = useState<string>(String(defaultNetworkId));

	const network = useMemo(
		() => APPKIT_CHAINS.find((a) => a.id === networkId) ?? null,
		[networkId],
	);

	const { accounts } = useWallets(); // kheopskit
	const [accountId, setAccountId] = useState<string>();
	const account = useMemo(
		() => accounts.find((a) => a.id === accountId) ?? null,
		[accountId, accounts],
	);
	const [recipientId, setRecipientId] = useState<string>();
	const recipient = useMemo(
		() => accounts.find((a) => a.id === recipientId) ?? null,
		[recipientId, accounts],
	);

	useEffect(() => {
		if ((!account || !recipient) && network && accounts.length) {
			const platform = /^\d+$/.test(String(network.id))
				? "ethereum"
				: "polkadot";
			const match = accounts.find((a) => a.platform === platform);
			if (match) {
				setAccountId(match.id);
				setRecipientId(match.id);
			}
		}
	}, [account, recipient, network, accounts]);

	return (
		<div className="flex flex-col gap-4">
			<div className="inline-grid grid-cols-[100px_auto] gap-4 items-center">
				<div>Network</div>
				<div>
					<Select
						onValueChange={setNetworkId}
						value={String(network?.id) ?? ""}
					>
						<SelectTrigger>
							<SelectValue placeholder="Network" />
						</SelectTrigger>
						<SelectContent>
							{APPKIT_CHAINS.map((network) => (
								<SelectItem key={network.id} value={String(network.id)}>
									{network.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div>From</div>
				<div>
					<Select onValueChange={setAccountId} value={account?.id ?? ""}>
						<SelectTrigger>
							<SelectValue placeholder="Account" />
						</SelectTrigger>
						<SelectContent>
							{accounts.map((account) => (
								<SelectItem key={account.id} value={account.id}>
									[{account.walletName}]{" "}
									{(account.platform === "polkadot" && account.name) ||
										account.address}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div>To</div>
				<div>
					<Select onValueChange={setRecipientId} value={recipient?.id ?? ""}>
						<SelectTrigger>
							<SelectValue placeholder="Recipient" />
						</SelectTrigger>
						<SelectContent>
							{accounts.map((account) => (
								<SelectItem key={account.id} value={account.id}>
									[{account.walletName}]{" "}
									{(account.platform === "polkadot" && account.name) ||
										account.address}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{!!network &&
					account?.platform === "ethereum" &&
					isHex(recipient?.address) && (
						<SubmitEthxTx
							chainId={Number(network.id)}
							account={account}
							recipient={recipient}
						/>
					)}

				{!!network &&
					account?.platform === "polkadot" &&
					recipient?.platform === "polkadot" && (
						<SubmitTxDot
							chainId={APPKIT_CHAIN_ID_TO_DOT_CHAIN_ID[network.id]}
							account={account}
							recipient={recipient}
						/>
					)}
			</div>
		</div>
	);
};

const SubmitEthxTx: FC<{
	chainId: number;
	account: EthereumAccount;
	recipient: WalletAccount;
}> = ({ chainId, account, recipient }) => {
	// biome-ignore lint/suspicious/noExplicitAny: legacy
	const chain = VIEM_CHAINS_BY_ID[chainId] as any;

	const [txHash, setTxHash] = useState<string | null>(null);

	const handleSendClick = async () => {
		if (!isHex(recipient.address)) return;
		try {
			const walletChainId = await account.client.getChainId();

			if (walletChainId !== chainId) {
				try {
					await account.client.switchChain({
						id: chainId,
					});
				} catch (err) {
					console.error("Error switching chain", err);
					await account.client.addChain({
						chain,
					});
				}
			}

			const publicClient = createPublicClient({ chain, transport: http() });
			const gas = await publicClient.estimateGas({
				to: recipient.address,
				value: 0n,
			});

			const hash = await account.client.sendTransaction({
				chain,
				to: recipient.address,
				value: 0n,
				gas,
			});
			setTxHash(hash);

			toast.success(`Transaction submitted: ${hash}`);

			const receipt = await publicClient.waitForTransactionReceipt({ hash });

			if (receipt.status === "success") toast.success("Transaction successful");
			else toast.error("Transaction reverted");
		} catch (err) {
			toast.error(
				`Error: ${(err as RpcError).shortMessage ?? (err as Error).message}`,
			);
		}
	};

	const blockExplorerUrl = useMemo(() => {
		if (!chain || !txHash) return null;
		const blockExplorer = chain.blockExplorers?.default;
		if (!blockExplorer) return null;
		return `${blockExplorer.url}/tx/${txHash}`;
	}, [chain, txHash]);

	return (
		<>
			<div>
				<Button
					disabled={!account || !chain || !isHex(recipient.address)}
					onClick={handleSendClick}
				>
					Send
				</Button>
			</div>
			<div>
				{!!blockExplorerUrl && (
					<a href={blockExplorerUrl}>View on block explorer</a>
				)}
			</div>
		</>
	);
};

const SubmitTxDot: FC<{
	chainId: PolkadotChainId;
	account: PolkadotAccount;
	recipient: PolkadotAccount;
}> = ({ chainId, account, recipient }) => {
	const [tx, setTx] = useState<Observable<TxEvent>>();
	const [txStatus, setTxStatus] = useState<TxEvent | null>(null);

	useEffect(() => {
		if (!tx) return;

		const sub = tx.subscribe((status) => {
			setTxStatus(status);

			const id = status.txHash; // for toasts

			switch (status.type) {
				case "signed": {
					toast.loading(`Transaction signed: ${status.txHash}`, {
						id,
					});
					break;
				}
				case "broadcasted": {
					toast.loading(`Transaction broadcasted: ${status.txHash}`, {
						id,
					});
					break;
				}
				case "txBestBlocksState": {
					if (status.found) {
						if (status.ok) {
							toast.success("Transaction successful", {
								id,
							});
						} else {
							toast.error("Transaction failed", {
								id,
							});
						}
						setTx(undefined);
					}
					break;
				}
			}
		});

		return () => {
			sub.unsubscribe();
		};
	}, [tx]);

	const handleSendClick = () => {
		try {
			console.log("Sending transaction", { chainId, recipient, account });
			const api = getPolkadotApi(chainId as PolkadotChainId);

			const tx$ = api.tx.Balances.transfer_keep_alive({
				dest: MultiAddress.Id(recipient.address),
				value: 0n,
			}).signSubmitAndWatch(account.polkadotSigner);

			setTx(tx$);
		} catch (err) {
			console.error("Error sending transaction", { err });
			toast.error(
				`Error: ${(err as RpcError).shortMessage ?? (err as Error).message}`,
			);
		}
	};

	const blockExplorerUrl = useMemo(() => {
		if (!txStatus?.txHash) return null;
		const chain = APPKIT_CHAINS.find((c) => c.id === chainId);
		if (!chain) return null;

		const blockExplorer = chain.blockExplorers?.default;
		if (!blockExplorer) return null;
		return `${blockExplorer.url}/tx/${txStatus.txHash}`;
	}, [txStatus, chainId]);

	return (
		<>
			<div>
				<Button disabled={!account} onClick={handleSendClick}>
					Send
				</Button>
			</div>
			<div>
				{!!blockExplorerUrl && (
					<a href={blockExplorerUrl}>View on block explorer</a>
				)}
			</div>
		</>
	);
};

const useDefaultNetworkId = () => {
	const { config } = useWallets();

	return useMemo(() => {
		if (!config.platforms?.length)
			throw new Error("No platforms configured in KheopskitConfig");

		if (config.platforms.includes("polkadot")) {
			const polkadotChains = APPKIT_CHAINS.filter(isPolkadotNetwork);
			if (!polkadotChains.length)
				throw new Error("No Polkadot chains configured in KheopskitConfig");
			return polkadotChains[0].id;
		}

		if (config.platforms.includes("ethereum")) {
			const ethereumChains = APPKIT_CHAINS.filter(isEthereumNetwork);
			if (!ethereumChains.length)
				throw new Error("No Ethereum chains configured in KheopskitConfig");
			if (ethereumChains.length === 1) return ethereumChains[0].id;
		}

		throw new Error("No default network found for the selected platforms");
	}, [config.platforms]);
};
