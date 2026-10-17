import type { BaseWalletAccount, WalletPlatform } from "../api/types";

const PLATFORM_ORDER: Record<WalletPlatform, number> = {
	polkadot: 0,
	ethereum: 1,
	solana: 2,
};

const byPlatform = (a1: BaseWalletAccount, a2: BaseWalletAccount) =>
	PLATFORM_ORDER[a1.platform] - PLATFORM_ORDER[a2.platform];

// Group accounts by wallet, surfacing Talisman first (case-insensitive).
const byWalletName = (a1: BaseWalletAccount, a2: BaseWalletAccount) => {
	if (a1.walletName === a2.walletName) return 0;
	if (a1.walletName.toLowerCase() === "talisman") return -1;
	if (a2.walletName.toLowerCase() === "talisman") return 1;
	return a1.walletName.localeCompare(a2.walletName);
};

export const sortAccounts = (a1: BaseWalletAccount, a2: BaseWalletAccount) =>
	byPlatform(a1, a2) || byWalletName(a1, a2);
