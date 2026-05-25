# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.12.x | ✅ active |
| 0.11.x (original `videoclaw`) | ❌ legacy — please migrate to 0.12.x; see `docs/MIGRATION.md` |
| `vclaw-video-core` 0.1.x | ❌ intermediate rebuild — superseded by v2 |

## Reporting a vulnerability

If you find a security issue:

1. **Do NOT open a public GitHub issue.**
2. Open a private security advisory on the repo:
   <https://github.com/davendra/videoclaw-v2/security/advisories/new>
3. Include:
   - A description of the vulnerability
   - Steps to reproduce
   - Affected versions
   - (Optional) proposed fix

I aim to respond within 7 days. Coordinated disclosure preferred.

## Scope

In scope:
- CLI argument handling (`src/cli/vclaw.ts`)
- Provider adapter dispatch (`src/video/provider-adapter-runner.ts`,
  `src/video/execution-runtime.ts`)
- Native HTTP transports (`src/video/native-*.ts`)
- Per-project state handling (anything that writes inside `projects/<slug>/`)
- The bundled `vclaw-cli/` Bun package (Google Flow scraping, UseAPI HTTP)
- The Python pipeline (`skills/video-replicator/scripts/`)

Out of scope:
- Provider-side API misuse / abuse (report to the provider directly)
- DoS via large project trees (project-level concerns)
- Skill `SKILL.md` content (these are prompts/docs, not executable surface
  beyond what the skill itself runs)

## Disclosure

After a fix lands, I'll publish a security advisory with:
- The CVE (if assigned)
- Affected version range
- Migration / upgrade instructions
- Credit (if you want attribution)
