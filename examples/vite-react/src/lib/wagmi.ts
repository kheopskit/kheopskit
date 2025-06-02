import { http, createConfig } from "wagmi";
import type { Chain } from "wagmi/chains";
import {
  APPKIT_CHAINS,
  VIEM_CHAINS_BY_ID,
  isEthereumNetwork,
} from "./config/chains";

const chains = APPKIT_CHAINS.filter(isEthereumNetwork).map(
  (network) => VIEM_CHAINS_BY_ID[Number(network.id)],
) as [Chain, ...Chain[]];

const transports = chains.reduce(
  (acc, chain) => {
    acc[chain.id] = http();
    return acc;
  },
  {} as Record<number, ReturnType<typeof http>>,
);

export const wagmiConfig = createConfig({
  chains,
  transports,
});
