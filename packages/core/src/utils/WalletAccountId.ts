import type { SS58String } from "polkadot-api";

import { isValidAddress } from "./isValidAddress";

export type WalletAccountId = string;

export const getWalletAccountId = (
  walletId: string,
  address: SS58String,
): WalletAccountId => {
  if (!walletId) throw new Error("Missing walletId");
  if (!isValidAddress(address)) throw new Error("Invalid address");
  return `${walletId}::${address}`;
};

export const parseWalletAccountId = (accountId: string) => {
  if (!accountId) throw new Error("Invalid walletAccountId");
  const [walletId, address] = accountId.split("::");
  if (!walletId) throw new Error("Missing walletId");
  if (!address || !isValidAddress(address)) throw new Error("Invalid address");
  return { walletId, address };
};
