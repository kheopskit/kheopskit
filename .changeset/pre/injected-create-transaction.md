---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Changed: injected Polkadot wallets that implement `signer.createTransaction` now build the transaction themselves, when the installed polkadot-api exports `getAccountTxCreator` from `polkadot-api/pjs-signer`. This signs on chains whose transaction extensions pjs-signer does not know, such as Paseo Asset Hub's `AsScarcity`. Other wallets and polkadot-api versions keep signing with `signPayload`.
