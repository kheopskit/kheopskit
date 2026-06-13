import type { WalletAccount, WalletPlatform } from "../api";

const PLATFORM_ORDER: Record<WalletPlatform, number> = {
	polkadot: 0,
	ethereum: 1,
	solana: 2,
};

// Group accounts by wallet, surfacing Talisman first (case-insensitive).
const byWalletName = (a1: WalletAccount, a2: WalletAccount) => {
	if (a1.walletName.toLowerCase() === "talisman") return -1;
	if (a2.walletName.toLowerCase() === "talisman") return 1;
	return a1.walletName.localeCompare(a2.walletName);
};

export const sortAccounts = (a1: WalletAccount, a2: WalletAccount) => {
	// Sort by platform first: polkadot, then ethereum, then solana
	if (a1.platform !== a2.platform)
		return PLATFORM_ORDER[a1.platform] - PLATFORM_ORDER[a2.platform];

	// Then group by wallet name
	if (a1.walletName !== a2.walletName) return byWalletName(a1, a2);

	// Polkadot accounts expose a friendly name; fall back to address
	if (a1.platform === "polkadot" && a2.platform === "polkadot")
		return a1.name !== a2.name
			? (a1.name ?? "").localeCompare(a2.name ?? "")
			: a1.address.localeCompare(a2.address);

	// Ethereum and Solana accounts disambiguate by id
	return a1.id.localeCompare(a2.id);
};
