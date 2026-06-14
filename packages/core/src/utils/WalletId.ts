import type { WalletPlatform } from "../api/types";
import { isWalletPlatform } from "./isWalletPlatform";

export type WalletId = string;

/**
 * Stable id of the single WalletConnect connector. It is platform-less: one WC
 * session spans whichever namespaces the wallet approves, so it isn't tied to a
 * platform (unlike injected wallet ids, which are `<platform>:<identifier>`).
 */
export const WALLET_CONNECT_WALLET_ID: WalletId = "walletconnect";

export const getWalletId = (
	platform: WalletPlatform,
	identifier: string,
): WalletId => {
	if (!isWalletPlatform(platform)) throw new Error("Invalid platform");
	if (!identifier) throw new Error("Invalid name");
	return `${platform}:${identifier}`;
};

export const parseWalletId = (walletId: string) => {
	if (!walletId) throw new Error("Invalid walletId");
	const [platform, identifier] = walletId.split(":");
	if (!isWalletPlatform(platform)) throw new Error("Invalid platform");
	if (!identifier) throw new Error("Invalid address");
	return { platform, identifier };
};

/**
 * Non-throwing variant of {@link parseWalletId}. Use when validating untrusted
 * input (e.g. cached state persisted by an older version) before parsing.
 */
export const isValidWalletId = (walletId: unknown): walletId is WalletId => {
	if (typeof walletId !== "string" || !walletId) return false;
	if (walletId === WALLET_CONNECT_WALLET_ID) return true;
	const [platform, identifier] = walletId.split(":");
	return isWalletPlatform(platform) && !!identifier;
};
