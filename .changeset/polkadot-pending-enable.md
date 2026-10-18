---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Fixed: a Polkadot `connect()` started while the extension prompt of an abandoned attempt (aborted `signal` or `disconnect()`) is still open now waits for that prompt instead of calling `enable()` again, and connects when the user approves it. Before, Talisman rejected the new attempt with `USER_REJECTED` ("has not been authorised") and polkadot-js with `CONNECT_FAILED` ("Pending authorisation request already exists"), and approving the first prompt connected nothing.
