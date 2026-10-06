---
name: Cloud save safety
description: Why retries and ambiguous commits must not overwrite or remove existing keepsake media
---

Treat repeated saves of the same card ID as retries, not edits. Isolate files per save attempt, and preserve media when a timed-out or disconnected commit may finish later.

**Why:** Fixed object paths let a retry overwrite existing photo bytes before its card commits; rollback can then damage a previously saved keepsake. A missing acknowledgement is not proof that the write failed.

**How to apply:** Keep create/retry behavior separate from any future editing feature. Do not add automatic orphan deletion based only on a timeout, an unavailable read, or cached document absence.

Cloud regression tests must use a demo project, loopback emulators, and synthetic media; never a family's live bucket or files.

**Why:** The user explicitly required isolated testing without changing or deleting actual family photos/voices, changing Cloud IAM or billing, or exposing the general Google API key.

**How to apply:** Maintain fail-closed endpoint checks and credential-free test subprocesses when extending the test suite.
