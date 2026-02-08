import type {
	CachedAccount,
	CachedWallet,
	EthereumAccount,
	EthereumInjectedWallet,
	PolkadotAccount,
	PolkadotInjectedWallet,
	Wallet,
	WalletAccount,
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

/**
 * Error thrown when trying to use a placeholder wallet that hasn't fully loaded yet.
 */
class PendingWalletError extends Error {
	constructor(walletId: string) {
		super(
			`Wallet ${walletId} is still loading. Wait for isHydrating to be false before calling connect/disconnect.`,
		);
		this.name = "PendingWalletError";
	}
}

/**
 * Converts a CachedWallet to a placeholder Wallet object.
 * The placeholder has the same display properties but connect/disconnect throw errors.
 *
 * @param cached - The cached wallet data from storage
 * @returns A placeholder Wallet object that can be displayed but not interacted with
 */
export const hydrateWallet = (cached: CachedWallet): Wallet => {
	const { platform, identifier } = parseWalletId(cached.id);

	const throwPending = () => {
		throw new PendingWalletError(cached.id);
	};

	// All wallet types (injected + AppKit) are hydrated as injected placeholders.
	// AppKit wallets can't be hydrated properly without the AppKit instance,
	// so they use injected type as a display fallback and will be replaced
	// when the real wallet loads.

	const icon = lookupWalletIcon(platform, identifier);

	if (platform === "polkadot") {
		return {
			id: cached.id,
			platform: "polkadot",
			type: "injected",
			extensionId: identifier,
			extension: undefined,
			name: cached.name,
			icon,
			isConnected: cached.isConnected,
			connect: throwPending,
			disconnect: throwPending,
		} satisfies PolkadotInjectedWallet;
	}

	if (platform === "ethereum") {
		return {
			id: cached.id,
			platform: "ethereum",
			type: "injected",
			providerId: identifier,
			provider: {} as never, // Placeholder - will be replaced by real wallet
			name: cached.name,
			icon,
			isConnected: cached.isConnected,
			connect: throwPending,
			disconnect: throwPending,
		} satisfies EthereumInjectedWallet;
	}

	// Should never happen if CachedWallet is properly typed
	throw new Error(`Unknown platform: ${platform}`);
};

/**
 * Converts a CachedAccount to a placeholder WalletAccount object.
 *
 * @param cached - The cached account data from storage
 * @returns A placeholder WalletAccount object that can be displayed
 */
export const hydrateAccount = (cached: CachedAccount): WalletAccount => {
	if (cached.platform === "polkadot") {
		return {
			id: cached.id as WalletAccountId,
			platform: "polkadot",
			address: cached.address,
			name: cached.name,
			walletId: cached.walletId,
			walletName: cached.walletName,
			// PolkadotSigner is required but we can't provide a real one
			// This is a placeholder that will be replaced by the real account
			polkadotSigner: {} as never,
		} satisfies PolkadotAccount;
	}

	if (cached.platform === "ethereum") {
		return {
			id: cached.id as WalletAccountId,
			platform: "ethereum",
			address: cached.address as `0x${string}`,
			walletId: cached.walletId,
			walletName: cached.walletName,
			isWalletDefault: false,
			client: {} as never, // Placeholder
		} satisfies EthereumAccount;
	}

	throw new Error(`Unknown platform: ${cached.platform}`);
};

/**
 * Converts a Wallet to a CachedWallet for storage.
 * Only extracts the serializable properties needed for hydration.
 *
 * @param wallet - The wallet to serialize
 * @returns A CachedWallet suitable for storage
 */
export const serializeWallet = (wallet: Wallet): CachedWallet => ({
	id: wallet.id,
	platform: wallet.platform,
	type: wallet.type,
	name: wallet.name,
	// Note: icon is NOT stored to save cookie space
	isConnected: wallet.isConnected,
});

/**
 * Converts a WalletAccount to a CachedAccount for storage.
 * Only extracts the serializable properties needed for hydration.
 *
 * @param account - The account to serialize
 * @returns A CachedAccount suitable for storage
 */
export const serializeAccount = (account: WalletAccount): CachedAccount => ({
	id: account.id,
	platform: account.platform,
	address: account.address,
	name: "name" in account ? account.name : undefined,
	walletId: account.walletId as WalletId,
	walletName: account.walletName,
});
