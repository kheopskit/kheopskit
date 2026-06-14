import type {
	BaseWallet,
	BaseWalletAccount,
	CachedAccount,
	CachedWallet,
	PolkadotAccountType,
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
 * Converts a CachedWallet to a placeholder wallet for SSR hydration display.
 *
 * The placeholder carries only the SDK-free {@link BaseWallet} fields; the real
 * wallet (with its injected provider/extension/standard-wallet handle) replaces
 * it once it loads. connect/disconnect throw until then.
 */
export const hydrateWallet = (cached: CachedWallet): BaseWallet => {
	const { platform, identifier } = parseWalletId(cached.id);

	const throwPending = () => {
		throw new PendingWalletError(cached.id);
	};

	return {
		id: cached.id,
		platform: cached.platform,
		type: cached.type,
		name: cached.name,
		icon: lookupWalletIcon(platform, identifier),
		isConnected: cached.isConnected,
		connect: throwPending,
		disconnect: throwPending,
	};
};

/**
 * Converts a CachedAccount to a placeholder account for SSR hydration display.
 *
 * The placeholder carries the SDK-free {@link BaseWalletAccount} fields plus the
 * plain, serializable platform data that lives in the cache — Ethereum `chainId`
 * and the Polkadot key `type`. Those render immediately on reload (no blank →
 * value flicker) and match what the live account will report. Only the SDK
 * handles (`client`/`signer`/`polkadotSigner`) are absent until the real account
 * replaces this placeholder; signing stays gated on `isHydrating` until then.
 */
export const hydrateAccount = (cached: CachedAccount): BaseWalletAccount => ({
	id: cached.id as WalletAccountId,
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
		type: cached.polkadotAccountType,
	}),
});

/**
 * Converts a wallet to a CachedWallet for storage.
 * Only extracts the serializable properties needed for hydration.
 */
export const serializeWallet = (wallet: BaseWallet): CachedWallet => ({
	id: wallet.id,
	platform: wallet.platform,
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
	walletId: account.walletId as WalletId,
	walletName: account.walletName,
});
