---
name: Cloud save safety
description: Why retries and ambiguous commits must not overwrite or remove existing keepsake media
---

Treat repeated saves of the same card ID as retries, not edits. Isolate files per save attempt, and preserve media when a timed-out or disconnected commit may finish later.

**Why:** Fixed object paths let a retry overwrite existing photo bytes before its card commits; rollback can then damage a previously saved keepsake. A missing acknowledgement is not proof that the write failed.

**How to apply:** Keep create/retry behavior separate from any future editing feature. Do not add automatic orphan deletion based only on a timeout, an unavailable read, or cached document absence.

Age alone never proves that an orphan is safe to remove. Unknown/active outcomes and pre-tracking files remain protected indefinitely; cleanup of proven-finished attempts requires an individual confirmation, a seven-day grace period, and a permanent server-side fence against delayed reuse.

**Why:** Even a very old disconnected writer can return later. Automatically treating absence or age as abandonment trades storage savings for a possible loss of a child's photo/voice. This project deliberately prefers retention when completion cannot be established.

**How to apply:** Keep read-only discovery separate from deletion. Do not reset/delete cleanup fences or retroactively mark historical attempts finished based only on missing card references. Any assisted resolution of uncertain attempts needs an explicit cancellation/recovery design.

Cloud regression tests must use a demo project, loopback emulators, and synthetic media; never a family's live bucket or files.

**Why:** The user explicitly required isolated testing without changing or deleting actual family photos/voices, changing Cloud IAM or billing, or exposing the general Google API key.

**How to apply:** Maintain fail-closed endpoint checks and credential-free test subprocesses when extending the test suite.

Keep builds and watched-file edits out of browser passes that use an in-memory synthetic service.

**Why:** A dev-server reload can reset the synthetic backing state mid-test, making a successful deletion appear to reappear on rescan. A stable-document recheck distinguished that fixture reset from a real persistence defect.

**How to apply:** Finish builds before starting the browser pass. When synthetic state unexpectedly resets, inspect navigation/module reloads before changing production persistence logic.
