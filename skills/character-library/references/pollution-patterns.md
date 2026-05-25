# Pollution Patterns

Common Go Bananas character-library failure modes:

## Too Vague

Symptoms:

- fewer than roughly 80 characters of description
- no concrete silhouette, clothing, or species details
- style is implied but not written

Result:

- cross-scene drift
- accessories disappear
- similar characters collapse into one generic look

## Too Bloated

Symptoms:

- prompt reads like a paragraph of lore rather than a reusable identity anchor
- multiple environments or actions embedded in the base prompt
- more than roughly 400 characters with repeated adjectives

Result:

- harder to maintain
- easier to contradict during scene prompting

## Species Or Archetype Mismatch

Symptoms:

- name implies an animal but the prompt reads like a human
- prompt mixes "organic rabbit" with "mechanical drone" style language
- a child or elder archetype is described with incompatible body framing

Result:

- identity instability
- provider confusion on anchor reuse

## Style Mismatch

Symptoms:

- photorealistic prompt used in a stylized animated workflow
- anime terms mixed with live-action cinematic descriptors without intent
- no mention of the render lane at all

Result:

- inconsistent outputs between projects

## Missing Reference Images

Symptoms:

- character record exists but `reference_images` is empty

Result:

- director preflight blocks
- even good prompts perform weakly in continuity-heavy scenes

## Repair Order

1. Patch vague or bloated language first.
2. Restore or regenerate reference images second.
3. Delete only if the entry is fundamentally polluted or duplicated.
