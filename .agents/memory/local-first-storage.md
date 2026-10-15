---
name: Local-first keepsake storage
description: Durable storage, migration, and child-mode decisions for the encyclopedia.
---

IndexedDB is the normal storage location after one initial copy from Firebase. The migration must retain all Firebase originals and must not create ongoing cross-device synchronization. If the first import cannot run, fail visibly and do not mark migration complete. Child mode has view-only and add/edit variants; neither permits deletion, and opening settings from child mode requires a parental gate.

**Why:** the user chose a device-local library while preserving the previous cloud copy, and wants child-safe operation without deletion.

**How to apply:** route future reads and writes to IndexedDB after migration. Do not delete Firebase source data or add automatic syncing unless the user explicitly changes this decision.
