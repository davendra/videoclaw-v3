# Agent Integration Research

> **Status:** Phase 9b research output. Two parallel investigations into
> current best practices (May 2026) for how CLI tools integrate with agentic
> coding tools and what makes a CLI "agent-friendly."
>
> **Research date:** 2026-05-25
> **Purpose:** Inform the v2→v3 unification design — specifically the question
> "should videoclaw build its own orchestration layer (intent classifier, NL
> front door, skill router) or be a clean CLI that external agents drive?"

## Headline finding

**Universal across all 2026 data points: intent classification is the host's
job, not the CLI's job.** Every successful example — Language Server Protocol,
Model Context Protocol, Claude Code skills, Warp's natural-language terminal,
the CLI-Anything project — moves intent OUTSIDE the tool. No mainstream CLI
has built its own NL front door successfully. Where intent classification
exists, it lives in the terminal / IDE / agent runtime.

**Quantitative penalty for getting this wrong:** A 2026 benchmark cited in
the research found agents calling raw CLIs beat MCP-wrapped equivalents
**10-32× on token cost** and **100% vs 72% on reliability**. Embedding an LLM
intent layer inside the CLI itself is even worse — adds tokens, adds
maintenance, adds prompt-injection surface, locks the CLI to a model
provider.

## Agent-CLI integration mechanisms (May 2026)

| Mechanism | Maturity | Best for | Cost to expose | Discoverability |
|---|---|---|---|---|
| **Claude Code skill** | Production-ready | Procedural knowledge, workflows, repeatable tasks | ~15 min (markdown file) | Auto-triggered by description match; manual `/skill-name`; descriptions loaded in context |
| **MCP server** | Production-ready (standardized) | External state access, live APIs, databases | 2-4 hours (Python/TS SDK) | Explicit tool listing in client UI; ~55K tokens for 5 servers pre-discovery (Tool Search reduces ~85%) |
| **Raw CLI shell-out** | Universal | Quick integration, stateless operations | ~5 min (just call it) | Manual command chaining; no built-in discoverability |
| **OpenAI Codex plugins** | New 2026 | Bundle skills + MCP + apps into reusable workflows | Varies by component | Plugin marketplace; skill names + MCP servers self-describe |
| **Google Antigravity 2.0** | New at I/O May 2026 | Multi-agent orchestration, desktop/CLI/SDK integrations | 1-2 hours (SDK-based) | CLI auto-discovery; agent orchestration UI; voice support |

## CLI extensibility prior art (2026)

| Pattern | Tool example | Discoverability | Install model | Lessons |
|---|---|---|---|---|
| **Owner-prefixed binaries on $PATH** | GitHub CLI extensions (`gh-*`) | Topic tag + `gh extension browse` | `gh extension install owner/repo` | Cheap; relies on social/star-driven discovery. Works because `gh` already won the user base. |
| **Curated index + per-plugin manifest** | kubectl + Krew | Central plugin index repo (~200 plugins) | YAML manifest, checksum-verified | Strong UX but maintenance cost real; two-tier ecosystem (indexed vs ad-hoc) creates friction. |
| **Signed registry + protocol** | Terraform providers | `registry.terraform.io` | GPG-signed, semver, declarative `required_providers` | Heavyweight. Justified by infra supply-chain risk. Overkill for video CLI. |
| **First-class extension API + marketplace** | VSCode, JetBrains | Centralized marketplace | One-click install; sandboxed runtime | Gold standard ONLY because IDE provides rich UI APIs. CLI has no UI surface — copying this is a category error. |
| **`bin` field in package manifest** | Any npm CLI | None (npm search / GitHub / blog) | `npm i -g pkg` registers shims | Already how videoclaw ships. Keep the bin surface small. |
| **Protocol, not plugin model** | LSP, MCP | Clients discover servers via config | Servers run as separate processes | **The winning pattern of the last decade.** 150+ language servers because the host doesn't dictate runtime/lang. **This is the analogue for an agent-driven CLI: be the "server," let agents/IDEs be the "client."** |

## "Did anyone successfully build intent-in-CLI?" — No, with caveats

- **Warp** embeds an intent classifier in the **terminal**, not in any individual CLI. The terminal routes NL to commands; the CLIs it drives stay narrow.
- **Claude Code Agent Skills** move the "intent layer" OUT of CLIs. Each skill is a `SKILL.md` with name+description; the agent host loads them via progressive disclosure. CLIs are invoked from skills, they don't host skills.
- **HKUDS/CLI-Anything** explicitly recommends: "agent reasoning happens *outside* the CLI; the interface stays focused on direct, composable operations."
- **MCP servers** wrap intent at a layer ABOVE the CLI, not inside it.

The consistent pattern: **intent classification is the host's job. The CLI's job is to be a deterministic, introspectable target.**

## What "agent-friendly CLI" means in 2026

1. **Noun-verb command structure** — agents traverse a deterministic tree (`vclaw scene generate`, not `vclaw generate-scene`).
2. **Structured output by default when stdout isn't a TTY.** `--json` or `--output json` everywhere; NDJSON for streams. Human output goes to stderr or behind TTY detection.
3. **Self-describing surface.** `--help` is necessary but not sufficient. Ship a `schema` / `commands` dump that emits the full command tree + flags + artifact shapes as JSON. videoclaw already does this via `schemas/video/` — just expose it through a `vclaw schema` subcommand.
4. **Meaningful exit codes.** Not 0/1. Distinguish transient (retry) from permanent (give up). Pair with stable string error codes in JSON output (`{"code": "image_not_found"}`, not freeform messages).
5. **Idempotency + checkpointable state on disk.** videoclaw's `projects/<slug>/` checkpoint model is exactly the modern best practice — agents can crash/resume.
6. **No silent fallback across materially different routes** (videoclaw already enforces this). Agents need explicit failure to choose recovery, not magic.
7. **Token-frugal output.** Field masks, summary-vs-detail flags. A single chatty response can blow a context window.

## Advantage table — orchestration options for videoclaw

| Approach | Build cost | Token cost per agent run | Discoverability | Vendor lock-in | Future-proof |
|---|---|---|---|---|---|
| **Build own orchestration in videoclaw** (intent classifier, NL front door, skill router inside CLI) | 4-8 weeks initial + ongoing tuning | **10-32× more** than raw CLI | None — users have to know your DSL | None | ❌ Every agent host re-invents this layer; yours competes |
| **Ship as clean noun-verb CLI only** | 1-2 weeks (mostly cleanup) | Baseline (1×) | Agents introspect via `--help` + `vclaw schema --json` | None | ✅ Works with every current + future agent host |
| **Add MCP server on top** | +3-4 hours | Adds ~10-20K tokens per active server | Auto-listed in MCP-aware clients | MCP standard (multi-vendor) | ✅ Works in every MCP client |
| **Ship as Claude Code skills + Codex plugin** | +2-4 hours per platform | Skills ~30-50 tokens until invoked | Auto-trigger via description match | None — each platform's own format | ✅ Community-maintained |

## Reframing the four original pain points

| Original pain | Original framing | Reframed answer |
|---|---|---|
| Too many entrypoints | "Build single front door `vclaw make ...`" | Consolidate to one `vclaw` binary (F2a fold Python). No NL front door. |
| Skill discovery | "Build a skill picker" | Already solved by Claude Code's skill description-matching. We ship skills, host orchestrates. |
| Provider routing complexity | "Build smart auto-router" | Keep the existing router. Expose route choice + reasoning as JSON so agents pick. |
| Manual 6-stage pipeline | "Collapse into one command" | Agents walk the pipeline. Job: make each step crisp, idempotent, agent-friendly. |

## Recommendation locked in for Phase B design

**Do not build a custom orchestration layer.** Spend the saved 4-8 weeks on making videoclaw the best possible target for external orchestrators.

Concrete agenda for v3:

1. **Stay narrow.** No LLM, no intent classification, no NL front door inside the CLI.
2. **Agent-friendly polish** (1-2 weeks):
   - `vclaw schema --json` — dumps full command tree + flags + artifact schemas
   - `--json` default when stdout isn't a TTY
   - Stable string error codes
   - Exit-code taxonomy (0/1/2 minimum: success / user error / system error)
   - Noun-verb consistency audit
3. **Fold Python into TS (F2a)** — 3-4 weeks. Not for elegance, but: a single `npm install` is what makes videoclaw trivially driveable by every agent host.
4. **Optional MCP server** (+3-4 hours) — read-only queries (`list_projects`, `get_status`) for live introspection.
5. **Publish "videoclaw skills" pack** as separate plugin/repo (1 week) — `.claude/skills/videoclaw-*.md` for Claude Code; same approach for Codex when its plugin marketplace matures. **Lives outside the binary.**

## Sources

Both research investigations cited their sources. Key references:

- [Claude Code skills documentation](https://code.claude.com/docs/en/skills)
- [MCP protocol and server building](https://modelcontextprotocol.io/docs/develop/build-server)
- [OpenAI Codex plugins and CLI](https://developers.openai.com/codex/cli)
- [Google Antigravity 2.0 announcement](https://developers.googleblog.com/build-with-google-antigravity-our-new-agentic-development-platform/)
- [Rewrite Your CLI for Agents — The Undercurrent](https://www.theundercurrent.dev/p/rewrite-your-cli-for-agents-or-get) (10-32× token benchmark)
- [CLI-Anything: making software agent-native](https://github.com/HKUDS/CLI-Anything)
- [Writing CLI Tools That AI Agents Want to Use — dev.to](https://dev.to/uenyioha/writing-cli-tools-that-ai-agents-actually-want-to-use-39no)
- [Anthropic Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [GitHub CLI extensions docs](https://docs.github.com/en/github-cli/github-cli/using-github-cli-extensions)
- [Krew (kubectl plugins)](https://krew.sigs.k8s.io/)
- [LSP Wikipedia](https://en.wikipedia.org/wiki/Language_Server_Protocol)

## Next step

Phase B unification design spec at
`docs/superpowers/specs/2026-05-25-videoclaw-v3-unification-design.md`.
This research feeds in directly and resolves the orchestration question.
