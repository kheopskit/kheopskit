import { createConfig, http } from "wagmi";
import type { Chain } from "wagmi/chains";
import {
	APPKIT_CHAINS,
	isEthereumNetwork,
	VIEM_CHAINS_BY_ID,
} from "./config/chains";

// Map each enabled eip155 network to a viem Chain. Prefer viem's built-in
// definition; for custom chains viem doesn't ship (e.g. Polkadot Asset Hub EVM)
// fall back to the AppKit network definition with a numeric id — wagmi/viem
// require `id: number`, whereas AppKit networks carry it as a string. Without
// the fallback the missing viem chain is `undefined` and crashes the reduce
// below on `chain.id`.
const toViemChain = (network: (typeof APPKIT_CHAINS)[number]): Chain => {
	const viemChain = VIEM_CHAINS_BY_ID[Number(network.id)];
	if (viemChain) return viemChain;
	return { ...(network as unknown as Chain), id: Number(network.id) };
};

const chains = APPKIT_CHAINS.filter(isEthereumNetwork).map(toViemChain) as [
	Chain,
	...Chain[],
];

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
