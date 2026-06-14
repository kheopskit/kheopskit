---
"kheopskit": major
"@kheopskit/core": major
"@kheopskit/react": major
---

Version unification: @kheopskit/core, @kheopskit/react and the repository release tag now share a single version number, starting at 4.0.0, and will stay in lockstep going forward.

The version-alignment bump on its own introduces no API changes; this release also ships the Solana + plugin-architecture work (see the accompanying changeset), which **is** breaking. Consumers must update their ranges when upgrading: `@kheopskit/core` `^1.x` → `^4.0.0`, `@kheopskit/react` `^3.x` → `^4.0.0`.
