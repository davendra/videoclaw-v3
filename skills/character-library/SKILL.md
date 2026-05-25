---
name: character-library
description: Manage Go Bananas character records for clean-room VideoClaw workflows. Audit polluted entries, list the library, patch base prompts in place, and delete bad anchors without leaving the repo-local skill surface.
---

# Character Library

Use this skill when the task is about maintaining the shared Go Bananas
character library rather than creating a new project storyboard.

This is the clean-room companion to `skills/character-creator/SKILL.md`.

- `character-creator` owns creation and reference-sheet generation
- `character-library` owns browse, audit, patch, and delete operations

## When To Use

Trigger on:

- "list my characters"
- "audit the character library"
- "patch this drifting character"
- "delete polluted characters"
- "fix library hygiene before a director run"

## Core Contract

Every reusable character anchor should have:

1. A stable Go Bananas `id`
2. At least one reference image
3. A concise but specific `base_prompt`
4. Explicit species or archetype constraints
5. Style cues that match the intended render lane

## Recommended Workflow

1. List or audit the library first.
2. Patch entries that are vague, bloated, or style-mismatched.
3. Delete only when patching is insufficient.
4. Use `character-creator` when the right answer is a fresh replacement.
5. Bind repaired ids back into projects with `--gb-character Name:ID`.

## Operations

### List

```bash
bash skills/character-library/scripts/list.sh
bash skills/character-library/scripts/list.sh "^Komo"
```

### Audit

```bash
bash skills/character-library/scripts/audit.sh
```

The audit flags:

- overly short prompts that invite drift
- bloated prompts that become hard to maintain
- missing reference images
- basic species or archetype contradictions
- missing style language

### Patch

```bash
bash skills/character-library/scripts/patch.sh 247 "Mochi is a small fluffy white rabbit with long soft ears, bright dark eyes, soft white fur, a pink nose, companion-scale proportions, organic animal anatomy, and a cinematic neon-noir render style."
```

### Delete

```bash
bash skills/character-library/scripts/delete.sh 141 244
bash skills/character-library/scripts/delete.sh 141 244 --yes
```

The first call is a dry-run preview. `--yes` performs the delete.

## Creation And Replacement

When an entry is beyond repair, switch to
`skills/character-creator/SKILL.md` rather than rebuilding the flow here.

That keeps one canonical creation lane and one canonical library-hygiene lane.

## Prompt Template

Use the 8-field identity template from
`references/templates-by-archetype.md` when patching or recreating anchors.

Minimum fields:

1. Age or life stage
2. Species or ethnicity
3. Hair, fur, or material description
4. Eyes and facial expression
5. Distinctive feature
6. Outfit or silhouette anchor
7. Archetype lock, including what the character is not
8. Render-style language

## Related Surfaces

- `skills/character-creator/SKILL.md`
- `skills/director-video/SKILL.md`
- `vclaw video library clean`
- `vclaw video create --gb-character Name:ID`
