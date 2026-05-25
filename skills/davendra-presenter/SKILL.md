---
name: davendra-presenter
description: |
  Create a professional narrated video from a PDF slide deck featuring
  **Davendra**, a 3D Pixar-style executive presenter. Triggers on:
  "executive presenter", "exec deck video", "Davendra", "corporate
  narrated video".
aliasOf: brand-presenter
---

# Davendra Presenter (brand-presenter specialization)

Davendra is a `brand-presenter` specialization. The full workflow lives
in [`skills/brand-presenter/SKILL.md`](../brand-presenter/SKILL.md).
This stub provides the brand parameters.

**Brand profile:** [`brand-profile.json`](./brand-profile.json)

**Trigger:** When a user wants a narrated corporate / executive video
with a 3D Pixar-style host, route to `brand-presenter` with this profile
loaded.

**Assets:** `assets/davendra_intro_1.jpg` and the corresponding outro
image. The brand-profile.json points at them.

**Why this stub exists:** prior to Slice 2, the full ~820-line workflow
duplicated brand-presenter. Now consolidated via `brand-profile.json`.
