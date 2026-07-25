---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Bump `@noble/hashes` to `^2.2.0`. The 2.x export map dropped extensionless subpaths, so the internal address validators now import from `@noble/hashes/sha3.js` and `@noble/hashes/blake2.js` (`blake2b` no longer has its own module). No API or behavior change.
