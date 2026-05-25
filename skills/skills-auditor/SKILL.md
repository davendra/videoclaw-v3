---
name: skills-auditor
description: Audit local VideoClaw skills for production readiness, duplicates, invalid frontmatter, stale paths, missing OpenAI metadata, misplaced resources, and catalog drift.
---

# Skills Auditor

Use this skill to review the complete local skills ecosystem before shipping or after adding, moving, deleting, or consolidating skills.

## Audit Workflow

1. Inventory skills:
   - list every immediate `skills/*` directory
   - verify each top-level directory is an installable skill with `SKILL.md`
   - confirm no workspaces, benchmarks, generated outputs, or loose resource directories live directly under `skills/`
2. Validate metadata:
   - `SKILL.md` frontmatter has only `name` and `description`
   - `name` matches the folder name
   - every skill has `agents/openai.yaml`
   - catalog entries match local folders
3. Check consolidation:
   - alias or merged skills do not have local folders unless explicitly internal
   - old wrapper paths are not referenced by active skills
   - shared assets live under canonical skills or repo-level scripts
4. Check portability:
   - no absolute local paths
   - no stale `.claude/skills/...` command paths
   - shell scripts infer the repo root from their own location or accept environment overrides
5. Verify:
   - run the skill validator and catalog drift check
   - run syntax checks for bundled shell/Python scripts
   - run lint and the relevant tests

## Commands

```bash
find skills -mindepth 1 -maxdepth 1 -type d ! -exec test -e '{}/SKILL.md' ';' -print
find skills -maxdepth 2 \( -name README.md -o -name INSTALL.md -o -name QUICK_REFERENCE.md -o -name CHANGELOG.md -o -name VERSION \) -print
for d in skills/*; do [ -d "$d" ] || continue; [ -f "$d/agents/openai.yaml" ] || printf '%s\n' "$d"; done
rg -n "\.claude/skills|/Users/|skills/.+-workspace|skills/(bunty|davendra-presenter|nex-presenter|deepsearch|git-master|review|ralph-init|video-analyze-template|video-clone-ad|video-storyboard|video-thumbnail-lab)/" skills src templates package.json -g '!skills/skills-auditor/**'
npm run check:skills
```

## Checklist

Read `references/audit-checklist.md` for the full checklist and final report shape.

## Report Format

```markdown
SKILLS AUDIT REPORT

Inventory:
- local skills:
- deleted aliases:
- moved resources:

Findings:
- critical:
- high:
- medium:
- low:

Verification:
- npm run check:skills:
- npm run lint:
- tests:
- script syntax:

Remaining risks:
- external provider checks:
- manual review needed:
```
