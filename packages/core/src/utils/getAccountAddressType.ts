import { isEthereumAddress } from "./isEthereumAddress";
import { isSs58Address } from "./isSs58Address";

export type AccountAddressType = "ss58" | "ethereum";

export const getAccountAddressType = (address: string): AccountAddressType => {
  if (address.startsWith("0x")) {
    if (isEthereumAddress(address)) return "ethereum";
  } else if (isSs58Address(address)) return "ss58";
  throw new Error("Invalid address");
};
