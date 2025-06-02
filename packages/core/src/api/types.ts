import type { WalletAccountId } from "@/utils";
import type { WalletId } from "@/utils/WalletId";
import type { AppKit } from "@reown/appkit/core";
import type { AppKitNetwork } from "@reown/appkit/networks";
import type { Metadata } from "@walletconnect/universal-provider";
import type {
  InjectedExtension,
  InjectedPolkadotAccount,
} from "polkadot-api/pjs-signer";
import type {
  Account,
  CustomTransport,
  EIP1193Provider,
  WalletClient,
} from "viem";

export type KheopskitConfig = {
  autoReconnect: boolean;
  platforms: WalletPlatform[];
  walletConnect?: {
    projectId: string;
    metadata: Metadata;
    /** Defaults to wss://relay.walletconnect.com */
    relayUrl?: string;
    /**
     * list of CAIP-13 ids of polkadot-sdk chains
     * see https://docs.reown.com/advanced/multichain/polkadot/dapp-integration-guide#walletconnect-code%2Fcomponent-setup
     */
    networks: [AppKitNetwork, ...AppKitNetwork[]];
  };
  debug: boolean;
};

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

export type PolkadotAppKitWallet = {
  id: WalletId;
  platform: "polkadot";
  type: "appKit";
  appKit: AppKit;
  name: string;
  icon: string;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
};

export type PolkadotWallet = PolkadotInjectedWallet | PolkadotAppKitWallet;

export type EthereumInjectedWallet = {
  platform: "ethereum";
  type: "injected";
  id: WalletId;
  providerId: string;
  provider: EIP1193Provider;
  name: string;
  icon: string;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
};

export type EthereumAppKitWallet = {
  platform: "ethereum";
  type: "appKit";
  id: WalletId;
  appKit: AppKit;
  name: string;
  icon: string;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
};

export type EthereumWallet = EthereumInjectedWallet | EthereumAppKitWallet;

export type Wallet = PolkadotWallet | EthereumWallet;

export type WalletPlatform = Wallet["platform"];

export type PolkadotAccount = InjectedPolkadotAccount & {
  id: WalletAccountId;
  platform: "polkadot";
  walletName: string;
  walletId: string;
};

export type EthereumAccount = {
  id: WalletAccountId;
  platform: "ethereum";
  client: WalletClient<CustomTransport, undefined, Account, undefined>; // let consumer knows chain is unknown
  address: `0x${string}`;
  walletName: string;
  walletId: string;
  isWalletDefault: boolean;
};

export type WalletAccount = PolkadotAccount | EthereumAccount;
