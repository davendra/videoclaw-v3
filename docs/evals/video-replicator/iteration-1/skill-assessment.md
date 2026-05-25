# Video Replicator Skill — Assessment

## Overview
- **Size**: 3,919 lines (7.8x the recommended 500 line limit)
- **Reference files**: 21
- **Bundled scripts**: 108 Python files
- **Modes**: 7 (COPY, CREATE, COPY NARRATED, PRESENTATION, LONG-FORM, FILM, UGC CAMPAIGN)
- **Version**: 2.43

## Critical Issues

### 1. Massive SKILL.md (3,919 lines)
The skill is nearly 8x the recommended 500-line limit. This means the full skill content consumes enormous context when loaded. Key concern: Claude may miss important details buried deep in the file (similar to the ui-ux-pro-max contrast ratio regression).

**Recommendation**: Restructure into a lean core SKILL.md (~500 lines) covering mode selection, the Pro model requirement, aspect ratio decision tree, and high-level pipeline overview. Move detailed mode workflows into `references/` files:
- `references/copy-mode.md`
- `references/create-mode.md`
- `references/narrated-mode.md`
- `references/presentation-mode.md`
- `references/longform-mode.md`
- `references/film-mode.md`
Claude reads only the relevant mode reference after selection.

### 2. Description Length
The current description is 30+ lines in the YAML frontmatter. While comprehensive, it's very long for a trigger description. The trigger phrases are good but could be more concise.

### 3. Pro Model Requirement
The skill CORRECTLY requires `gemini-pro-image` (the Go Bananas user memory says "always use NB2" but that's for the go-bananas-app project context, not this video project where character adherence requires Pro).

### 4. 108 Bundled Scripts
Having 108 scripts in the skill directory is unusually large. Many of these appear to be the actual project scripts symlinked or copied into the skill. This is fine from a functionality standpoint but means the skill IS the project's script library.

### 5. No Existing Evals
The skill has never been formally evaluated. This is a first-time eval.

## Strengths

1. **Comprehensive mode selection guidance** — clear decision tree with explicit trigger phrases
2. **SEALCAM+ framework** — structured analysis approach that's unique to this skill
3. **Aspect ratio decision tree** — explicitly handles the I2V portrait API limitation
4. **Pre-flight validation** — checks before generation to catch issues early
5. **Run versioning** — proper artifact management across generations
6. **Interactive review mode** — web-based review checkpoints
7. **Agent-assisted review** — AI QA agents for automated quality checks
8. **21 reference files** — extensive domain knowledge library

## Eval Strategy

Testing 3 modes that exercise the most differentiated skill behavior:
1. **COPY mode** (eval 1) — tests SEALCAM+ analysis, correct pipeline ordering, I2V mode for landscape
2. **CREATE mode with portrait** (eval 2) — tests mode selection, I2V/T2V decision for portrait, scene wizard
3. **FILM mode** (eval 4) — tests screenplay pipeline, Seedance backend, cinematic workflow

These test the skill's core decision-making without requiring actual video generation.
