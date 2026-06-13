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
	extensionId: string;
	extension: InjectedExtension | undefined;
	name: string;
	icon: string;
	isConnected: boolean;
	connect: () => Promise<void>;
	disconnect: () => void;
};

export type PolkadotWallet = PolkadotInjectedWallet | PolkadotAppKitWallet;

export type PolkadotAccount = Omit<InjectedPolkadotAccount, "type"> & {
	type: PolkadotAccountType;
	id: WalletAccountId;
	platform: "polkadot";
	walletName: string;
	walletId: string;
};
