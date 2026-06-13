import { createSolanaRpc } from "@solana/kit";

const RPC_URL = "https://api.mainnet-beta.solana.com";

let cached: ReturnType<typeof createSolanaRpc> | null = null;

export const getSolanaRpc = () => {
	if (!cached) cached = createSolanaRpc(RPC_URL);
	return cached;
};
