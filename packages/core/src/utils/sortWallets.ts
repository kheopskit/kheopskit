import type { Wallet } from "@/api";

export const sortWallets = (w1: Wallet, w2: Wallet) => {
  // Sort by platform first: polkadot first, then ethereum
  if (w1.platform !== w2.platform) {
    return w1.platform === "polkadot" ? -1 : 1;
  }

  // Sort by name, but Talisman first
  if (w1.name.toLowerCase() === "talisman") return -1;
  if (w2.name.toLowerCase() === "talisman") return 1;

  return w1.name.localeCompare(w2.name);
};
