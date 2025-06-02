import { isAddress } from "viem";

export const isEthereumAddress = (address: string): boolean =>
  isAddress(address);
