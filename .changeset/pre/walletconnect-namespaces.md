---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Fixed: `walletConnect()` asks AppKit for Polkadot and Solana methods only when `networks` includes a network of that namespace. Before, a Polkadot-only dapp sent an empty Solana namespace, and Reown rejected the pairing, so the modal closed without a QR code.
