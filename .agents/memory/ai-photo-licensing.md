---
name: AI photo library licensing
description: Why local background removal uses an Apache-licensed alternative to IMG.LY.
---

Prefer Apache-2.0 Transformers.js with the Apache-2.0 ORMBG model for local background removal rather than replacing it with IMG.LY by default.

**Why:** Earlier licensing research found `@imgly/background-removal` is AGPL-3.0. The user's IMG.LY references are examples, not a requirement to accept that license.

**How to apply:** When changing the background-removal implementation, verify both library and model licenses. Keep the Apache-licensed approach unless a different licensing tradeoff is explicitly agreed.
