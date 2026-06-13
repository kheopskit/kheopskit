import { blake2b } from "@noble/hashes/blake2b";
import { base58 } from "@scure/base";

// The "SS58PRE" prefix used in the SS58 checksum preimage.
const SS58PRE = new Uint8Array([0x53, 0x53, 0x35, 0x38, 0x50, 0x52, 0x45]);

/**
 * Returns true if `address` is a valid SS58-encoded 32-byte account id (the
 * only form Substrate wallets inject), verifying the blake2b-512 checksum.
 *
 * Dependency-free (base58 via @scure/base, blake2b via @noble/hashes) so core
 * stays decoupled from polkadot-api.
 */
export const isSs58Address = (address: string): boolean => {
	if (!address) return false;

	let decoded: Uint8Array;
	try {
		decoded = base58.decode(address);
	} catch {
		return false;
	}

	// First byte encodes the network prefix; the high bit is reserved/invalid.
	const firstByte = decoded[0];
	if (firstByte === undefined || firstByte & 0b1000_0000) return false;
	// The 0b0100_0000 bit marks a 2-byte prefix.
	const prefixLength = firstByte & 0b0100_0000 ? 2 : 1;

	// AccountId32 layout: prefix + 32-byte pubkey + 2-byte checksum.
	if (decoded.length !== prefixLength + 32 + 2) return false;

	const body = decoded.subarray(0, decoded.length - 2);
	const preimage = new Uint8Array(SS58PRE.length + body.length);
	preimage.set(SS58PRE);
	preimage.set(body, SS58PRE.length);
	const hash = blake2b(preimage, { dkLen: 64 });

	return (
		decoded[decoded.length - 2] === hash[0] &&
		decoded[decoded.length - 1] === hash[1]
	);
};
