---
name: nex-presenter
description: |
  Create a professional narrated video from a PDF slide deck featuring
  **Nex**, a 3D Pixar-style tech commentator. Triggers on: "tech
  commentator", "tech review video", "Nex", "product walkthrough".
aliasOf: brand-presenter
---

# Nex Presenter (brand-presenter specialization)

Nex is a `brand-presenter` specialization. The full workflow lives in
[`skills/brand-presenter/SKILL.md`](../brand-presenter/SKILL.md). This
stub provides the brand parameters.

**Brand profile:** [`brand-profile.json`](./brand-profile.json)

**Trigger:** When a user wants a narrated tech / product video with a
3D Pixar-style host, route to `brand-presenter` with this profile loaded.

**Assets:** `assets/nex_intro_1.jpg` and the corresponding outro image.
The brand-profile.json points at them.

**Why this stub exists:** prior to Slice 2, the full ~842-line workflow
duplicated brand-presenter. Now consolidated via `brand-profile.json`.
