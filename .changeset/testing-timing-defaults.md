---
"kheopskit": patch
"@kheopskit/core": patch
"@kheopskit/react": patch
---

Added: `@kheopskit/core/testing` exports `DISCOVERY_WINDOW_MS`, `DEFAULT_HYDRATION_GRACE_PERIOD_MS` and `DEFAULT_HYDRATION_TIMEOUT_MS`, so a test advances fake timers past kheopskit's timings without copying the numbers.
