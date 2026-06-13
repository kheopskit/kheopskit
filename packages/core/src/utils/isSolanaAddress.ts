import { isAddress } from "@solana/kit";

/**
 * Returns true if the value is a valid Solana address: a base58-encoded
 * 32-byte ed25519 public key.
 *
 * Unlike SS58 addresses, Solana addresses carry no checksum, so this is a pure
 * base58 + length check (delegated to @solana/kit's `isAddress`).
 */
export const isSolanaAddress = (address: string): boolean =>
	!!address && isAddress(address);
