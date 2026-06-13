---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Fix WalletConnect accounts not appearing for Substrate. Reown AppKit never populates `getAccount("polkadot").allAccounts` (the polkadot namespace has no native AppKit adapter), so connected sessions reported zero accounts and no signer was available. Polkadot accounts are now derived from the WalletConnect session namespaces (CAIP-10 entries, deduplicated across chains), which is the authoritative source and works on all AppKit 1.8.x versions.
