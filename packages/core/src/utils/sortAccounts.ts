import type { WalletAccount } from "../api";

export const sortAccounts = (a1: WalletAccount, a2: WalletAccount) => {
	if (a1.platform === "polkadot") {
		if (a2.platform === "polkadot") {
			// sort by wallet name, fallback to address
			if (a1.walletName !== a2.walletName) {
				if (a1.walletName === "talisman") return -1;
				if (a2.walletName === "talisman") return 1;
				return a1.walletName.localeCompare(a2.walletName);
			}

			// sort by name, fallback to address
			return a1.name !== a2.name
				? (a1.name ?? "").localeCompare(a2.name ?? "")
				: a1.address.localeCompare(a2.address);
		}

		return -1; // polkadot accounts first
	}

	if (a2.platform === "ethereum") {
		// sort by wallet name, fallback to address
		if (a1.walletName !== a2.walletName) {
			if (a1.walletName === "Talisman") return -1;
			if (a2.walletName === "Talisman") return 1;
			return a1.walletName.localeCompare(a2.walletName);
		}

		// keep order as provider by the wallet
		return 0;
	}

	// impossible case
	return 0;
};
