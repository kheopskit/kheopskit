import { createSolanaRpc } from "@solana/kit";

// The official api.mainnet-beta.solana.com endpoint returns 403 to browser
// origins; use a CORS-enabled public mainnet RPC instead.
const RPC_URL = "https://solana-rpc.publicnode.com";

let cached: ReturnType<typeof createSolanaRpc> | null = null;

export const getSolanaRpc = () => {
	if (!cached) cached = createSolanaRpc(RPC_URL);
	return cached;
};
