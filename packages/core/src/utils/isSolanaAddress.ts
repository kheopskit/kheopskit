import { base58 } from "@scure/base";

/**
 * Returns true if the value is a valid Solana address: a base58-encoded
 * 32-byte ed25519 public key.
 *
 * Solana addresses carry no checksum, so this is a pure base58 + length check.
 * Dependency-free (base58 via @scure/base) so core stays decoupled from
 * @solana/kit.
 */
export const isSolanaAddress = (address: string): boolean => {
	if (!address) return false;
	try {
		return base58.decode(address).length === 32;
	} catch {
		return false;
	}
};
