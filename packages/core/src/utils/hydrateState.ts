import { walletPendingError } from "../api/errors";
import {
	type BaseWallet,
	type BaseWalletAccount,
	type CachedAccount,
	type CachedWallet,
	isWalletConnectWallet,
	type PolkadotAccountType,
	type WalletConnectWallet,
} from "../api/types";
import { POLKADOT_EXTENSIONS } from "./polkadotExtensions";
import type { WalletAccountId } from "./WalletAccountId";
import { parseWalletId, type WalletId } from "./WalletId";

/**
 * Looks up the icon for a wallet from known Polkadot extensions only.
 * Ethereum icons will be populated from the localStorage icon cache via the merge function.
 *
 * Note: We DON'T use localStorage icon cache here because hydrateWallet is called
 * during SSR (server) and client hydration. localStorage isn't available on server,
 * so using it would cause a hydration mismatch. Icons for Ethereum wallets will be
 * populated when the hydration buffer merges cached wallets with live wallets.
 */
const lookupWalletIcon = (platform: string, identifier: string): string => {
	// Only Polkadot extensions have hardcoded icons that are safe for SSR
	if (platform === "polkadot") {
		return POLKADOT_EXTENSIONS[identifier]?.icon ?? "";
	}
	// Ethereum icons come from localStorage or live wallets - not here
	return "";
};

type PlaceholderOf<W> = W & { isPlaceholder: true; isConnected: false };

export const hydrateWallet = (
	cached: CachedWallet,
): PlaceholderOf<BaseWallet | WalletConnectWallet> => {
	const connect = async () => {
		throw walletPendingError(cached.id);
	};
	const disconnect = async () => {};

	if (cached.type === "walletconnect") {
		return {
			id: cached.id,
			type: "walletconnect",
			platforms: [],
			name: cached.name,
			icon: "",
			status: cached.isConnected ? "connecting" : "disconnected",
			isPlaceholder: true,
			isConnected: false,
			connect,
			disconnect,
		};
	}

	const { platform, identifier } = parseWalletId(cached.id);

	return {
		id: cached.id,
		platform: cached.platform as BaseWallet["platform"],
		type: cached.type,
		name: cached.name,
		icon: lookupWalletIcon(platform, identifier),
		status: cached.isConnected ? "connecting" : "disconnected",
		isPlaceholder: true,
		isConnected: false,
		connect,
		disconnect,
	};
};

export const hydrateAccount = (
	cached: CachedAccount,
): BaseWalletAccount & { isPlaceholder: true } => ({
	id: cached.id as WalletAccountId,
	isPlaceholder: true,
	platform: cached.platform,
	address: cached.address,
	name: cached.name,
	walletId: cached.walletId,
	walletName: cached.walletName,
	// Spread (not direct keys) so the extra platform fields don't trip the
	// excess-property check against BaseWalletAccount; they're read back via the
	// platform-specific account types once narrowed by `platform`.
	...(cached.platform === "ethereum" && { chainId: cached.chainId }),
	...(cached.platform === "polkadot" && {
		type: cached.polkadotAccountType ?? "sr25519",
		...(cached.polkadotReadonly && { readonly: true }),
	}),
	...(cached.platform === "solana" && { chains: [] }),
});

/**
 * Converts a wallet to a CachedWallet for storage.
 * Only extracts the serializable properties needed for hydration.
 */
export const serializeWallet = (
	wallet: BaseWallet | WalletConnectWallet,
): CachedWallet => ({
	id: wallet.id,
	// The WalletConnect connector has no platform.
	platform: isWalletConnectWallet(wallet) ? undefined : wallet.platform,
	type: wallet.type,
	name: wallet.name,
	// Note: icon is NOT stored to save cookie space
	isConnected: wallet.isConnected,
});

/**
 * Converts an account to a CachedAccount for storage.
 * Only extracts the serializable properties needed for hydration. Platform-only
 * fields (Ethereum chainId, Polkadot key type) are read defensively so this
 * stays SDK-free.
 */
export const serializeAccount = (
	account: BaseWalletAccount,
): CachedAccount => ({
	id: account.id,
	platform: account.platform,
	address: account.address,
	name: account.name,
	chainId:
		account.platform === "ethereum"
			? (account as { chainId?: number }).chainId
			: undefined,
	polkadotAccountType:
		account.platform === "polkadot"
			? (account as { type?: PolkadotAccountType }).type
			: undefined,
	polkadotReadonly:
		account.platform === "polkadot" &&
		(account as { readonly?: boolean }).readonly
			? true
			: undefined,
	walletId: account.walletId as WalletId,
	walletName: account.walletName,
});
