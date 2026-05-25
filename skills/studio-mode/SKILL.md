---
name: studio-mode
description: Agent-driven video production — interview clarifies intent, consensus plans it, user approves before credits are spent. Invoke for "$studio" requests. Alternative to the fast, one-shot `vclaw video create`.
---

# Studio Mode — Agent-Driven Video Production

## When to use this skill

- User types `$studio "<description>"` or asks for "studio mode" video creation
- User wants a more considered, higher-quality video than `vclaw video create` produces
- User has a rough idea and wants help clarifying before spending credits

## When NOT to use this skill

- User runs `vclaw video create` directly (that's the fast path; don't intercept)
- User just wants to iterate quickly on a known idea

## Core flow

```
1. Clarify intent (up to 3 questions) via deep-interview skill
2. Run consensus planning via `vclaw video studio-plan`
3. Present plan.md to user; await approval
4. On approval: run `vclaw video studio-execute <slug>`
5. Report final video path and cost actuals
```

## Step-by-step

### Step 1: Parse the user's command

- `$studio "description"` → intent = "description"
- `$studio "..." --auto` → auto mode (skip user escalation in consensus)
- `$studio execute <slug>` → skip to Step 4 with existing plan
- `$studio list` → run `vclaw video studio-list`
- `$studio status <slug>` → run `vclaw video studio-status <slug>`
- `$studio clean <slug>` → run `vclaw video studio-clean <slug>`

### Step 2: Smart intent detection + interview

Before running the interview, classify the intent to pick branch-appropriate questions:

- Mentions a platform (TikTok, Shorts, Reels, LinkedIn, etc.)? → skip platform question
- Mentions characters by name or "character" keyword? → include character-ref question
- Has a duration ("30 seconds", "1 minute")? → skip duration question
- Has a style descriptor ("cinematic", "documentary", "UGC")? → skip style question

Then invoke the `oh-my-claudecode:deep-interview` skill with the intent.

**HARD CAP: ask at most 3 questions.** Prioritize the most-ambiguous ones. If the intent is already detailed, ask fewer.

### Step 3: Run consensus planning

After the interview produces a clarified brief, run:

```bash
vclaw video studio-plan --intent "<clarified brief>" [--auto]
```

Capture stdout. Three possible outputs:

**Happy path (exit 0, 3 lines):**
```
<slug>
<plan.json path>
<plan.md path>
```
→ Proceed to Step 4.

**Needs user (exit 2):**
```
NEEDS_USER
<session.json path>
<reason>
```
→ Ask user: "The critic keeps flagging [reason]. Would you like me to (1) try again, (2) accept current draft anyway, or (3) tell me what to change?" Act on their choice.

**Failure (exit 1, 3, or 4):** Read stderr, explain to user, exit.

### Step 4: Present plan + gate on approval

Read the plan.md file and print it to the user verbatim. Then ask:

> "Approve this plan? (yes / no / revise)"

- **yes** → proceed to Step 5
- **no** → exit gracefully. Remind user they can resume later with `$studio execute <slug>`
- **revise** → ask user what they'd like changed, then re-run Step 2-3 with the additional context

### Step 5: Execute

```bash
vclaw video studio-execute <slug>
```

Stream the output to the user. Re-running this command resumes from the last successful scene (mid-run state is checkpointed). When complete, display:

- Path to final.mp4 (read from `.omx/studio/<slug>/execution.json`)
- Estimated vs actual cost
- Any scenes that needed regeneration

### Step 6: Report

Show the user where their video is saved and offer next steps:

- Review the video
- Run `$studio list` to see all their sessions

## Error recovery

- **LLM call fails during interview:** Fall back to asking the user directly in chat
- **studio-plan times out:** Tell user, save state, they can re-invoke to resume
- **Execute fails mid-run:** Tell user to run `$studio execute <slug>` again to resume from the last successful scene

## Key rules

1. **Never spend credits without the approval gate.** User must see plan.md and say yes before Step 5.
2. **Don't ask more than 3 questions.** If intent is ambiguous, pick the 3 most-unblocking ones.
3. **Prefer re-invoking over branching.** If user wants a different take, re-run `$studio` with a new intent rather than mutating the current plan.
4. **Respect auto mode.** If user passed `--auto`, skip confirmation prompts and accept consensus output.

## Example session

```
User: $studio "cinematic chase scene neon Tokyo"
Skill: [invokes deep-interview]
        Q1: What platform — short-form vertical or wide-frame?
User:   wide-frame
        Q2: Any character references?
User:   none
        Q3: Target duration?
User:   45 seconds
Skill:  [runs vclaw video studio-plan --intent "cinematic chase scene neon Tokyo, 16:9, 45s, no characters"]
        Plan ready:

        ## Plan: cinematic-chase-scene-neon-tokyo
        **4 scenes · 45s · $4.20 est. · cinematic noir**
        | # | Duration | Shot | Setting | Mood | Characters |
        ...

Skill:  Approve? (yes/no/revise)
User:   yes
Skill:  [runs vclaw video studio-execute cinematic-chase-scene-neon-tokyo]
        ...generating scenes...
        Done. final.mp4 at <root>/projects/cinematic-chase-scene-neon-tokyo/final/final.mp4
        Actual cost: $4.87 (+$0.67 over estimate)
```
