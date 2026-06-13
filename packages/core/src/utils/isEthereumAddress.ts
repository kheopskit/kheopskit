import { keccak_256 } from "@noble/hashes/sha3";

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const encoder = new TextEncoder();

/**
 * Verifies the EIP-55 mixed-case checksum of an Ethereum address.
 * Dependency-free (keccak via @noble/hashes) so core stays decoupled from viem.
 */
const isChecksumValid = (address: string): boolean => {
	const hex = address.slice(2);
	const hash = keccak_256(encoder.encode(hex.toLowerCase()));
	for (let i = 0; i < 40; i++) {
		const char = hex.charAt(i);
		const isLetter =
			(char >= "a" && char <= "f") || (char >= "A" && char <= "F");
		if (!isLetter) continue;
		const byte = hash[i >> 1] ?? 0;
		const nibble = i % 2 === 0 ? byte >> 4 : byte & 0x0f;
		const isUpper = char <= "F";
		if (isUpper !== nibble >= 8) return false;
	}
	return true;
};

/**
 * Returns true if `address` is a valid Ethereum address.
 *
 * Mirrors viem's `isAddress` (strict): the shape must be `0x` + 40 hex, and a
 * mixed-case address must pass the EIP-55 checksum. All-lowercase addresses are
 * accepted as non-checksummed.
 */
export const isEthereumAddress = (address: string): boolean => {
	if (!HEX_ADDRESS.test(address)) return false;
	if (address === address.toLowerCase()) return true;
	return isChecksumValid(address);
};
