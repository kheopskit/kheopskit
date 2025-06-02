import type {
  PolkadotAssetHubWhitelistEntry,
  PolkadotWhitelistEntry,
  WestendAssetHubWhitelistEntry,
} from "@polkadot-api/descriptors";

type WhiteListEntry =
  | PolkadotWhitelistEntry
  | PolkadotAssetHubWhitelistEntry
  | WestendAssetHubWhitelistEntry;

export const whitelist: WhiteListEntry[] = ["tx.Balances.transfer_keep_alive"];
