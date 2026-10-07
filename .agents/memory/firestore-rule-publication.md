---
name: Firestore rule publication
description: Distinguishes local emulator rules from the Firebase project's hosted rules.
---

**Rule:** Passing Firestore Emulator tests validates the repository's local rules only; it does not publish them to the hosted Firebase project.

**Why:** New owner settings and shared-viewer paths passed locally while the running app still received `permission-denied` from the hosted project.

**How to apply:** After changing `firebase/firestore.rules`, test the emulator and tell the user to publish that file in Firebase Console. Do not claim hosted rules were updated unless deployment was actually performed and confirmed.
