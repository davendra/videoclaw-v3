import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface VideoPromptReference {
  name: string;
  category: 'provider' | 'framework';
  summary: string;
  file: string;
}

const REFERENCE_REGISTRY: VideoPromptReference[] = [
  {
    name: 'seedance-ugc-formulas',
    category: 'provider',
    summary: 'Seedance formulas for UGC-style and character-led prompting.',
    file: 'seedance-ugc-formulas.md',
  },
  {
    name: 'veo-prompting-guide',
    category: 'provider',
    summary: 'Prompt structure and execution guidance for local Veo usage.',
    file: 'veo-prompting-guide.md',
  },
  {
    name: 'style-template-schema',
    category: 'framework',
    summary: 'Schema guidance for reusable style/template assets.',
    file: 'style-template-schema.md',
  },
  {
    name: 'stage-directors',
    category: 'framework',
    summary: 'Operational stage guidance for brief, storyboard, assets, review, and publish.',
    file: 'stage-directors.md',
  },
  {
    name: 'checkpoint-protocol',
    category: 'framework',
    summary: 'Checkpoint rules for explicit, artifact-based progression.',
    file: 'checkpoint-protocol.md',
  },
  {
    name: 'generation-telemetry',
    category: 'framework',
    summary: 'Rules for recording route, cost, duration, and output telemetry after generation.',
    file: 'generation-telemetry.md',
  },
  {
    name: 'dialogue-duration-preflight',
    category: 'framework',
    summary: 'Dialogue timing budgets for short clips and director-mode preflight.',
    file: 'dialogue-duration-preflight.md',
  },
  {
    name: 'character-reference-sheet',
    category: 'framework',
    summary: 'Reference-sheet coverage guidance for stable character identity.',
    file: 'character-reference-sheet.md',
  },
  {
    name: 'clone-ad-template-workflow',
    category: 'framework',
    summary: 'Reference-ad analysis dimensions for reusable clone plans.',
    file: 'clone-ad-template-workflow.md',
  },
];

function referencesDir(root = process.cwd()): string {
  return join(resolve(root), 'references', 'video');
}

export function listPromptReferences(): VideoPromptReference[] {
  return [...REFERENCE_REGISTRY];
}

export async function readPromptReference(
  name: string,
  root = process.cwd(),
): Promise<(VideoPromptReference & { content: string }) | null> {
  const entry = REFERENCE_REGISTRY.find((reference) => reference.name === name);
  if (!entry) return null;
  const path = join(referencesDir(root), entry.file);
  if (!existsSync(path)) return null;
  const content = await readFile(path, 'utf-8');
  return {
    ...entry,
    content,
  };
}
