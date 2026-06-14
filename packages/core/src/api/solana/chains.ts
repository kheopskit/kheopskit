import { KheopskitError } from "../errors";

/**
 * Wallet Standard chain identifiers for Solana clusters.
 *
 * These are the values wallets advertise in their `chains` arrays and the
 * values kheopskit accepts in `solana({ chain })`.
 *
 * @see https://github.com/anza-xyz/wallet-standard
 */
export type SolanaChainId =
	| "solana:mainnet"
	| "solana:devnet"
	| "solana:testnet"
	| "solana:localnet";

export const DEFAULT_SOLANA_CHAIN: SolanaChainId = "solana:mainnet";

const SOLANA_CHAIN_IDS = [
	"solana:mainnet",
	"solana:devnet",
	"solana:testnet",
	"solana:localnet",
] as const satisfies SolanaChainId[];

export const isSolanaChainId = (value: unknown): value is SolanaChainId =>
	typeof value === "string" &&
	(SOLANA_CHAIN_IDS as readonly string[]).includes(value);

/**
 * Maps Wallet Standard chain ids to the CAIP-2 chain ids used by WalletConnect.
 *
 * CAIP-2 ids use the first 32 characters of the cluster's genesis hash as the
 * reference. The values below match `@reown/appkit/networks` (solana,
 * solanaDevnet, solanaTestnet), which is what AppKit puts in session namespaces.
 *
 * `localnet` has no canonical CAIP-2 id and cannot be used over WalletConnect.
 */
const SOLANA_CHAIN_TO_CAIP2 = {
	"solana:mainnet": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
	"solana:devnet": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
	"solana:testnet": "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z",
} as const satisfies Partial<Record<SolanaChainId, string>>;

/**
 * Returns the CAIP-2 chain id for a Solana chain, for use in WalletConnect
 * requests and when reading WalletConnect session namespaces.
 *
 * @throws if the chain has no canonical CAIP-2 id (e.g. localnet)
 */
export const getSolanaCaip2 = (chain: SolanaChainId): string => {
	const caip2 = (SOLANA_CHAIN_TO_CAIP2 as Record<string, string | undefined>)[
		chain
	];
	if (!caip2)
		throw new KheopskitError(
			"UNSUPPORTED_CHAIN",
			`Solana chain "${chain}" cannot be used over WalletConnect (no CAIP-2 id).`,
		);
	return caip2;
};

/**
 * AppKit's *deprecated* CAIP-2 cluster ids (its `deprecatedCaipNetworkId`
 * values). Some wallets still place accounts in the WC session under these, so
 * map them back to a {@link SolanaChainId} instead of silently falling back to
 * the configured chain. Requests always use the current ids from
 * {@link SOLANA_CHAIN_TO_CAIP2}; testnet has no deprecated id.
 */
const DEPRECATED_CAIP2_TO_SOLANA_CHAIN: Record<string, SolanaChainId> = {
	"solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ": "solana:mainnet",
	"solana:8E9rvCKLFQia2Y35HXjjpWzj8weVo44K": "solana:devnet",
};

const CAIP2_TO_SOLANA_CHAIN: Record<string, SolanaChainId> = {
	...Object.fromEntries(
		Object.entries(SOLANA_CHAIN_TO_CAIP2).map(([chain, caip2]) => [
			caip2,
			chain as SolanaChainId,
		]),
	),
	...DEPRECATED_CAIP2_TO_SOLANA_CHAIN,
};

/**
 * Maps a CAIP-2 chain id (as found in WalletConnect session namespaces) back to
 * its {@link SolanaChainId}, or `undefined` if it isn't a recognised cluster.
 */
export const getSolanaChainIdFromCaip2 = (
	caip2: string,
): SolanaChainId | undefined => CAIP2_TO_SOLANA_CHAIN[caip2];
