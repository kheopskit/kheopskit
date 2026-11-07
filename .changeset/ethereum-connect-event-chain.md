---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Fixed: injected Ethereum accounts take their chain from the EIP-1193 `connect` event, so they no longer report no chain after the wallet disconnects and reconnects the site (for example, Talisman's Disconnect All then Connect All).
