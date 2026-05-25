import { updateSceneCandidatesArtifact } from './scene-candidate-store.js';
import { appendCandidate, maxRoundForScene, nextCandidateId } from './scene-candidates.js';
import type { SceneCandidate } from './types.js';

export interface RecordStoryboardStillCandidateInput {
  root: string;
  projectSlug: string;
  sceneIndex: number;
  imageUrl: string;
  candidateId?: string;
  imageId?: string;
  prompt?: string;
  notes?: string;
  route?: string;
  chainedFromCandidateId?: string | null;
  submittedAt?: string;
}

export interface RecordStoryboardStillCandidateResult {
  sceneIndex: number;
  candidate: SceneCandidate;
}

export async function recordStoryboardStillCandidate(
  input: RecordStoryboardStillCandidateInput,
): Promise<RecordStoryboardStillCandidateResult> {
  return updateSceneCandidatesArtifact(input.root, input.projectSlug, (artifact) => {
    const submittedAt = input.submittedAt ?? new Date().toISOString();
    const candidate: SceneCandidate = {
      id: input.candidateId ?? nextCandidateId(artifact, input.sceneIndex),
      generationRound: maxRoundForScene(artifact, input.sceneIndex) + 1,
      prompt: input.prompt ?? 'Storyboard still image generated from storyboard-stills-plan.json.',
      route: input.route ?? 'gobananas-storyboard-still',
      submittedAt,
      completedAt: submittedAt,
      status: 'completed',
      outputs: [
        {
          kind: 'image',
          path: input.imageUrl,
        },
      ],
      source: {
        executionRound: 0,
        adapter: 'custom',
        ...(input.imageId ? { externalJobId: input.imageId } : {}),
        chainedFromCandidateId: input.chainedFromCandidateId ?? null,
      },
    };
    return {
      artifact: appendCandidate(artifact, input.sceneIndex, candidate),
      result: {
        sceneIndex: input.sceneIndex,
        candidate,
      },
    };
  });
}
