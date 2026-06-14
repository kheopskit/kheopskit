import type { WalletPlatform } from "../api/types";

export const isWalletPlatform = (
	platform: unknown,
): platform is WalletPlatform =>
	typeof platform === "string" &&
	["polkadot", "ethereum", "solana"].includes(platform as WalletPlatform);
