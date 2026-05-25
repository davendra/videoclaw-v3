/**
 * vclaw schema --json — the v3 introspection bundle.
 *
 * Returns the full CLI contract in one call: commands, flags, artifact
 * schemas, error codes, exit codes. Agents call this once to learn the
 * surface, then drive the CLI without further introspection.
 *
 * Stateless function — no fs writes, no env reads, no network. Pure
 * read of bundled JSON + reflection of the dispatch table.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_ERROR_CODES } from './errors.js';
import { ExitCode } from './cli-output.js';

export interface CommandFlag {
  name: string;
  /** "value" if it takes an argument, "boolean" if it's a switch. */
  kind: 'value' | 'boolean';
  description?: string;
}

export interface CommandSpec {
  name: string;
  usage: string;
  description?: string;
  flags?: CommandFlag[];
  /** Backwards-compat aliases that dispatch to this command. */
  aliases?: string[];
}

export interface SchemaDump {
  version: string;
  generatedAt: string;
  exitCodes: Record<string, number>;
  errorCodes: ReadonlyArray<string>;
  commands: CommandSpec[];
  artifactSchemas: Record<string, unknown>;
}

/**
 * Hand-curated list of subcommands. Mirrors the dispatch switch at the
 * bottom of src/cli/vclaw.ts. Keeping these in sync is a test (see
 * cli-schema.test.ts — it spot-checks count > 30).
 *
 * Future improvement: generate this from the dispatch table at build time.
 * For v3.0.0-alpha, hand-curation is fine — there are ~50 commands and
 * they don't change often.
 */
const COMMANDS: CommandSpec[] = [
  // --- core lifecycle ---
  { name: 'video providers', usage: 'vclaw video providers [--workspace-root <path>]' },
  { name: 'video verify-env', usage: 'vclaw video verify-env [--root <path>] [--workspace-root <path>]' },
  { name: 'video init', usage: 'vclaw video init <slug> [--root <path>] [--mode storyboard|director]' },
  { name: 'video brief', usage: 'vclaw video brief --project <slug> --title <title> --intent <intent> [--root <path>] [--mode storyboard|director] [--platform <name>] [--aspect-ratio 16:9|9:16|1:1] [--quality fast|quality] [--resolution 720p|1080p] [--audio on|off] [--outputs 1-4]' },
  { name: 'video storyboard', usage: 'vclaw video storyboard --project <slug> (--scene <text> [--scene <text> ...] | --template <template-id>) [--root <path>] [--mode storyboard|director]' },
  { name: 'video assets', usage: 'vclaw video assets --project <slug> --asset <kind:path[:sceneIndex][:backend]> [--asset ...] [--root <path>]' },
  { name: 'video review', usage: 'vclaw video review --project <slug> --verdict pass|retry|fail [--finding <text> ...] [--root <path>]' },
  { name: 'video publish', usage: 'vclaw video publish --project <slug> --status ready|published|blocked [--final-output <path>] [--note <text> ...] [--root <path>]' },

  // --- creator-mode pipeline drivers ---
  { name: 'video create', usage: 'vclaw video create "<intent>" [--project <slug>] [...]' },
  { name: 'video auto', usage: 'vclaw video auto "<intent>" [--project <slug>] [...]' },
  { name: 'video iterate', usage: 'vclaw video iterate "<intent>" [--project <slug>] [...]' },
  { name: 'video run-pipeline', usage: 'vclaw video run-pipeline "<intent>" [--project <slug>] [...]' },
  { name: 'video approve', usage: 'vclaw video approve --project <slug> [--root <path>] [--mode storyboard|director] [--dry-run]' },

  // --- readiness + execution ---
  { name: 'video readiness', usage: 'vclaw video readiness --project <slug> [--root <path>] [--mode storyboard|director]' },
  { name: 'video plan', usage: 'vclaw video plan --project <slug> [--root <path>] [--mode storyboard|director]', aliases: ['video execution-plan'] },
  { name: 'video produce', usage: 'vclaw video produce --project <slug> [--root <path>] [--mode storyboard|director] [--dry-run] [--scene <sceneIndex> ...]', aliases: ['video execute'] },
  { name: 'video execute-status', usage: 'vclaw video execute-status --project <slug> [--root <path>] [--mode storyboard|director]' },
  { name: 'video execute-cancel', usage: 'vclaw video execute-cancel --project <slug> [--root <path>] [--mode storyboard|director]' },

  // --- director gate ---
  { name: 'video director-preflight', usage: 'vclaw video director-preflight --project <slug> [--root <path>] [--apply-content-fixes]' },
  { name: 'video storyboard-review', usage: 'vclaw video storyboard-review --project <slug> [--root <path>] [--mode storyboard|director] [--apply-content-fixes]' },

  // --- review UI ---
  { name: 'video review-ui', usage: 'vclaw video review-ui --project <slug> [--root <path>] [--host <host>] [--port <port>] [--ui-path <path>] [--dry-run]' },
  { name: 'video review-autopilot', usage: 'vclaw video review-autopilot --project <slug> [--root <path>] [--template <template-id>] [--character <name>] [--run-id <id>]' },

  // --- character management ---
  { name: 'video character-add', usage: 'vclaw video character-add --project <slug> --name <name> [--gb-id <id>] [...] [--root <path>]' },
  { name: 'video character-auto-create', usage: 'vclaw video character-auto-create --project <slug> --input <json-path> [--root <path>] [--api-url <url>] [--dry-run]' },
  { name: 'video character-import-library', usage: 'vclaw video character-import-library --project <slug> --intent "<text>" [--root <path>] [--api-url <url>]' },
  { name: 'video character-list', usage: 'vclaw video character-list --project <slug> [--root <path>]' },
  { name: 'video character-show', usage: 'vclaw video character-show --project <slug> --name <name> [--root <path>]' },
  { name: 'video character-consistency', usage: 'vclaw video character-consistency --project <slug> [--root <path>]' },

  // --- reference sheets ---
  { name: 'video reference-sheet-add', usage: 'vclaw video reference-sheet-add --project <slug> --type <type> --name <name> [...]' },
  { name: 'video reference-sheet-list', usage: 'vclaw video reference-sheet-list --project <slug> [--type <sheet-type>] [--root <path>]' },
  { name: 'video reference-sheet-show', usage: 'vclaw video reference-sheet-show --project <slug> --id <sheet-id> [--root <path>]' },
  { name: 'video reference-sheet-bind', usage: 'vclaw video reference-sheet-bind --project <slug> --id <sheet-id> --scene <sceneIndex> [...]' },
  { name: 'video reference-sheet-validate', usage: 'vclaw video reference-sheet-validate --project <slug> [--root <path>]' },

  // --- candidates ---
  { name: 'video candidates-list', usage: 'vclaw video candidates-list --project <slug> [--scene <sceneIndex>] [--root <path>]' },
  { name: 'video candidates-show', usage: 'vclaw video candidates-show --project <slug> --candidate-id <id> [--root <path>]' },
  { name: 'video select-candidate', usage: 'vclaw video select-candidate --project <slug> --scene <sceneIndex> --candidate-id <id> [--notes <text>] [--root <path>]' },
  { name: 'video reject-candidate', usage: 'vclaw video reject-candidate --project <slug> --scene <sceneIndex> --candidate-id <id> [--notes <text>] [--root <path>]' },
  { name: 'video reroll-scene', usage: 'vclaw video reroll-scene --project <slug> --scene <sceneIndex> [...]' },
  { name: 'video chain-from', usage: 'vclaw video chain-from --project <slug> --scene <sceneIndex> --source-scene <sceneIndex> [...]' },
  { name: 'video unchain', usage: 'vclaw video unchain --project <slug> --scene <sceneIndex> [...]' },

  // --- templates + clone ---
  { name: 'video template-list', usage: 'vclaw video template-list [--root <path>]' },
  { name: 'video template-show', usage: 'vclaw video template-show --name <template-name> [--root <path>]' },
  { name: 'video clone-plan', usage: 'vclaw video clone-plan --template <template-name> --project <slug> --intent <text> [--root <path>]' },

  // --- portfolio + status ---
  { name: 'video list', usage: 'vclaw video list [--root <path>]' },
  { name: 'video index', usage: 'vclaw video index [--root <path>] [--output <path>]' },
  { name: 'video metrics', usage: 'vclaw video metrics [--root <path>] [--mode storyboard|director]' },
  { name: 'video next-actions', usage: 'vclaw video next-actions [--root <path>] [--mode storyboard|director]' },
  { name: 'video report', usage: 'vclaw video report [--root <path>] [--mode storyboard|director]' },
  { name: 'video status', usage: 'vclaw video status --project <slug> [--root <path>] [--mode storyboard|director]' },
  { name: 'video doctor-project', usage: 'vclaw video doctor-project --project <slug> [--root <path>] [--mode storyboard|director]' },
  { name: 'video doctor-portfolio', usage: 'vclaw video doctor-portfolio [--root <path>] [--mode storyboard|director]' },

  // --- export + obsidian ---
  { name: 'video export-csv', usage: 'vclaw video export-csv [--root <path>] [--output-dir <path>] [--mode storyboard|director]' },
  { name: 'video export-obsidian', usage: 'vclaw video export-obsidian --project <slug> [--root <path>] [--output-dir <path>] [--mode storyboard|director]' },
  { name: 'video sync-obsidian', usage: 'vclaw video sync-obsidian [--root <path>] [--output-dir <path>] [--mode storyboard|director]' },

  // --- veo (Bun bridge for Google Flow) ---
  { name: 'veo status', usage: 'vclaw veo status [batchId]', description: 'Show status of current or specific Veo batch.' },
  { name: 'veo list', usage: 'vclaw veo list', description: 'List all Veo batches.' },
  { name: 'veo history', usage: 'vclaw veo history [--limit <n>]', description: 'Show recent Veo job history.' },
  { name: 'veo resume', usage: 'vclaw veo resume [batchId]', description: 'Resume a paused Veo batch.' },
  { name: 'veo reset', usage: 'vclaw veo reset', description: 'Reset failed Veo jobs to pending.' },
  { name: 'veo cancel', usage: 'vclaw veo cancel', description: 'Cancel current Veo batch.' },
  { name: 'veo useapi:accounts', usage: 'vclaw veo useapi:accounts list|add [--cookies <path>]', description: 'Manage useapi.net accounts (via Bun bridge).' },
  { name: 'veo useapi:captcha', usage: 'vclaw veo useapi:captcha list | --provider <name> --key <key>', description: 'Manage useapi.net CAPTCHA providers.' },
  { name: 'veo useapi:health', usage: 'vclaw veo useapi:health', description: 'useapi.net account health + history.' },
  { name: 'veo useapi:image', usage: 'vclaw veo useapi:image --image-prompt "<text>" [--image-model imagen-4|nano-banana|nano-banana-pro] [--ref <url> ...] [--yes]', description: 'Generate images via useapi.net (Imagen-4 / nano-banana family).' },
  { name: 'veo useapi:image:upscale', usage: 'vclaw veo useapi:image:upscale --media-id <id> --resolution 2k|4k', description: 'Upscale a nano-banana-pro image.' },
  { name: 'veo useapi:gif', usage: 'vclaw veo useapi:gif --media-id <id> --output-file <path>', description: 'Convert a Veo video to GIF (free, no CAPTCHA).' },
  { name: 'veo useapi:upscale', usage: 'vclaw veo useapi:upscale --media-id <id> --resolution 1080p|4k', description: 'Upscale a Veo video.' },

  // --- mcp server ---
  { name: 'mcp serve', usage: 'vclaw mcp serve', description: 'Start the videoclaw MCP server (stdio) exposing read-only project introspection to MCP-aware agent hosts.' },

  // --- introspection ---
  { name: 'schema', usage: 'vclaw schema [--json]', description: 'Dump the full v3 contract (commands, flags, artifact schemas, error codes, exit codes) for agent introspection.' },
];

function loadArtifactSchemas(): Record<string, unknown> {
  const here = dirname(fileURLToPath(import.meta.url));
  const schemasDir = join(here, '..', '..', 'schemas', 'video', 'artifacts');
  const out: Record<string, unknown> = {};
  let entries: string[];
  try {
    entries = readdirSync(schemasDir);
  } catch (err: unknown) {
    // Directory missing is expected in some test envs. Anything else
    // (permission denied, etc.) is genuinely unexpected.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return out;
    }
    throw err;
  }
  for (const file of entries) {
    if (!file.endsWith('.schema.json')) continue;
    const name = file.replace(/\.schema\.json$/, '');
    const raw = readFileSync(join(schemasDir, file), 'utf-8');
    // JSON.parse errors propagate — a corrupt schema should fail loudly.
    out[name] = JSON.parse(raw);
  }
  return out;
}

export function buildSchemaDump(): SchemaDump {
  return {
    version: '3.0.0-alpha.0',
    generatedAt: new Date().toISOString(),
    exitCodes: { ...ExitCode },
    errorCodes: ALL_ERROR_CODES,
    commands: COMMANDS,
    artifactSchemas: loadArtifactSchemas(),
  };
}
