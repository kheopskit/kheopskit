import {
	type BaseWallet,
	isWalletConnectWallet,
	type WalletConnectWallet,
	type WalletPlatform,
} from "../api/types";

const PLATFORM_ORDER: Record<WalletPlatform, number> = {
	polkadot: 0,
	ethereum: 1,
	solana: 2,
};

// The platform-less WalletConnect connector sorts after all platform wallets.
const orderOf = (wallet: BaseWallet | WalletConnectWallet) =>
	isWalletConnectWallet(wallet) ? 3 : PLATFORM_ORDER[wallet.platform];

export const sortWallets = (
	w1: BaseWallet | WalletConnectWallet,
	w2: BaseWallet | WalletConnectWallet,
) => {
	// Sort by platform first: polkadot, then ethereum, then solana, then WC
	const o1 = orderOf(w1);
	const o2 = orderOf(w2);
	if (o1 !== o2) return o1 - o2;

	// Sort by name, but Talisman first
	if (w1.name.toLowerCase() === "talisman") return -1;
	if (w2.name.toLowerCase() === "talisman") return 1;

	return w1.name.localeCompare(w2.name);
};
