import type {
	InjectedExtension,
	InjectedPolkadotAccount,
} from "polkadot-api/pjs-signer";
import type { WalletAccountId } from "../../utils/WalletAccountId";
import type { WalletId } from "../../utils/WalletId";
import type { PolkadotAccountType, PolkadotAppKitWallet } from "../types";

export type PolkadotInjectedWallet = {
	id: WalletId;
	platform: "polkadot";
	type: "injected";
	/**
	 * Stable identifier of the underlying wallet source. For Polkadot this is the
	 * injected extension identifier. Named consistently across platforms
	 * (Ethereum: EIP-6963 rdns; Solana: Wallet Standard name).
	 */
	sourceId: string;
	extension: InjectedExtension | undefined;
	name: string;
	icon: string;
	isConnected: boolean;
	connect: () => Promise<void>;
	disconnect: () => Promise<void>;
};

export type PolkadotWallet = PolkadotInjectedWallet | PolkadotAppKitWallet;

/**
 * A Polkadot account. Inherits the fields of polkadot-api's
 * `InjectedPolkadotAccount` — notably the signing surface **`polkadotSigner`**
 * (a `PolkadotSigner`) — and narrows `type` to {@link PolkadotAccountType}.
 *
 * Per-platform signing surfaces differ: Ethereum exposes `client` (viem),
 * Solana `signer`/`getSigner(chain)`. `polkadotSigner` is absent while
 * `state.isHydrating` is `true`.
 */
export type PolkadotAccount = Omit<InjectedPolkadotAccount, "type"> & {
	type: PolkadotAccountType;
	id: WalletAccountId;
	platform: "polkadot";
	walletName: string;
	walletId: WalletId;
};
