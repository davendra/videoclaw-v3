---
name: bunty
description: |
  "Match Day Analysis with Bunty" — cricket scorecard or play-cricket URL
  to a narrated video with Bunty (cartoon Indian commentator in orange
  blazer, character_id=97). Triggers on: cricket scorecards, play-cricket
  URLs, "Match Day Analysis", "Bunty".
aliasOf: brand-presenter
---

# Bunty (brand-presenter specialization)

Bunty is a `brand-presenter` specialization. The full workflow lives in
[`skills/brand-presenter/SKILL.md`](../brand-presenter/SKILL.md). This
stub provides the brand parameters that specialize the parent workflow.

**Brand profile:** [`brand-profile.json`](./brand-profile.json)

**Trigger:** When a user provides a cricket scorecard PDF, a play-cricket
URL, or asks for "Match Day Analysis", route to `brand-presenter` with
this profile loaded.

**Assets:** `assets/` holds Bunty's intro/outro reference images +
auxiliary character-sheet materials. The brand-profile.json points at
them.

**Why this stub exists:** prior to Slice 2 (2026-05-25 cutover), Bunty's
full workflow lived in this SKILL.md as a 560-line copy of the
brand-presenter pipeline. The duplication is now consolidated in
`brand-presenter` with this profile-driven specialization.
