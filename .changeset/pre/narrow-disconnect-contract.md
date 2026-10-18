---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Docs: a `disconnect()` whose platform call is still pending or refused leaves a granted `connect()` to resolve once the state shows the wallet connected, and a `disconnect()` waiting for the platform settles with the platform's answer.
