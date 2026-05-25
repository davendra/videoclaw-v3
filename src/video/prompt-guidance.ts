import type { ProviderRouteId, VideoOperationKind } from './provider-platform/types.js';
import type { VideoProductionMode } from './types.js';
import type { VideoPromptReference } from './prompt-library.js';
import { listPromptReferences } from './prompt-library.js';

export interface VideoPromptGuidanceEntry {
  name: string;
  reason: string;
  category: VideoPromptReference['category'];
}

function findReference(name: string): VideoPromptReference | null {
  return listPromptReferences().find((reference) => reference.name === name) ?? null;
}

export function buildPromptGuidance(input: {
  routeId: ProviderRouteId | null;
  operationKind: VideoOperationKind;
  productionMode: VideoProductionMode;
}): VideoPromptGuidanceEntry[] {
  const guidance: VideoPromptGuidanceEntry[] = [];

  const add = (name: string, reason: string): void => {
    const reference = findReference(name);
    if (!reference) return;
    if (guidance.some((entry) => entry.name === name)) return;
    guidance.push({
      name,
      reason,
      category: reference.category,
    });
  };

  add('checkpoint-protocol', 'Execution should remain artifact-based and checkpoint-driven.');
  add('stage-directors', `Use stage discipline for ${input.productionMode} production flow.`);
  add('style-template-schema', 'Template and execution work should preserve reusable style boundaries.');
  add('generation-telemetry', 'Execution should preserve route, duration, cost, and output telemetry for future estimates.');

  if (input.routeId === 'seedance-direct') {
    add('seedance-ugc-formulas', 'Selected route is Seedance; use Seedance-specific prompt structure.');
  }

  if (input.routeId === 'veo-useapi') {
    add('veo-prompting-guide', 'Selected route is Veo; use Veo-specific prompt structure.');
  }

  if (input.operationKind === 'text-to-video') {
    add('veo-prompting-guide', 'Text-to-video execution benefits from compact visible-action prompting.');
    add('seedance-ugc-formulas', 'Text-to-video execution benefits from explicit subject-action-camera ordering.');
    add('dialogue-duration-preflight', 'Short-form dialogue should fit the target clip duration before execution.');
  }

  if (input.operationKind === 'image-to-video' || input.operationKind === 'frames-to-video') {
    add('veo-prompting-guide', 'Image-driven execution needs correct input-mode phrasing.');
    add('seedance-ugc-formulas', 'Reference-driven execution still needs concise action and camera structure.');
  }

  if (input.productionMode === 'director') {
    add('character-reference-sheet', 'Director mode should bind identity references to character-bearing scenes.');
    add('dialogue-duration-preflight', 'Director preflight should catch dialogue that cannot fit the clip duration.');
  }

  return guidance;
}
