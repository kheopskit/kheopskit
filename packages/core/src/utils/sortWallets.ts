import type { BaseWallet, WalletPlatform } from "../api/types";

const PLATFORM_ORDER: Record<WalletPlatform, number> = {
	polkadot: 0,
	ethereum: 1,
	solana: 2,
};

export const sortWallets = (w1: BaseWallet, w2: BaseWallet) => {
	// Sort by platform first: polkadot, then ethereum, then solana
	if (w1.platform !== w2.platform) {
		return PLATFORM_ORDER[w1.platform] - PLATFORM_ORDER[w2.platform];
	}

	// Sort by name, but Talisman first
	if (w1.name.toLowerCase() === "talisman") return -1;
	if (w2.name.toLowerCase() === "talisman") return 1;

	return w1.name.localeCompare(w2.name);
};
