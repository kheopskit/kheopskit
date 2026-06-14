import type { WalletPlatform } from "../api/types";
import { isWalletPlatform } from "./isWalletPlatform";

export type WalletId = string;

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
	const [platform, identifier] = walletId.split(":");
	return isWalletPlatform(platform) && !!identifier;
};
