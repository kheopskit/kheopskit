import { isEthereumAddress } from "./isEthereumAddress";
import { isSs58Address } from "./isSs58Address";

export const isValidAddress = (address: string): boolean => {
	return address.startsWith("0x")
		? isEthereumAddress(address)
		: isSs58Address(address);
};
