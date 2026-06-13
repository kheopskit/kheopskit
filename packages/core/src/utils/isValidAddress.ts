import { isEthereumAddress } from "./isEthereumAddress";
import { isSolanaAddress } from "./isSolanaAddress";
import { isSs58Address } from "./isSs58Address";

export const isValidAddress = (address: string): boolean => {
	if (address.startsWith("0x")) return isEthereumAddress(address);
	// SS58 (checksummed) and Solana (base58, no checksum) are disjoint: a
	// 32-byte Solana pubkey fails SS58 decoding, and an SS58 address decodes to
	// more than 32 bytes so it fails the Solana length check.
	return isSs58Address(address) || isSolanaAddress(address);
};
