# videoclaw skills pack

Sample Claude Code / Codex skills demonstrating how to drive videoclaw
as an external agent. These are TEMPLATES — copy them into your own
`.claude/skills/` directory (or publish them as a separate
`videoclaw-skills` repo for distribution).

Per the [agent-integration research](../../docs/AGENT_INTEGRATION_RESEARCH.md),
intent classification is the agent host's job. These skills show the
host HOW to call videoclaw's deterministic CLI surface — they don't
embed orchestration logic in videoclaw itself.

## Skills

| Skill | What it does |
|---|---|
| `videoclaw-create-video` | Drives a full video creation: init → brief → storyboard → assets → execute → assemble |
| `videoclaw-check-status` | Polls `vclaw video status` + `vclaw mcp` for project state |
| `videoclaw-portfolio-review` | Surfaces the portfolio dashboard via `vclaw video metrics` + `next-actions` |

## How agents discover videoclaw

1. `vclaw schema --json` — one call returns the full command tree, flags, artifact schemas, error codes, exit codes.
2. `vclaw mcp serve` — for hosts that prefer MCP, exposes read-only project introspection as MCP tools.

## Publishing as a separate repo

These live inside the videoclaw repo under `mcp/skills-pack/` for
reference. To distribute: copy this directory to a standalone
`videoclaw-skills` GitHub repo, add an install script, and point users
at it. (Manual follow-up — not automated in v3.0.)
