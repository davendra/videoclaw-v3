export interface DialogueFitScene {
  sceneIndex?: number;
  dialogue?: string;
  durationSeconds?: number;
}

export interface DialogueFitIssue {
  severity: 'warn' | 'error';
  code: 'DIALOGUE_DURATION_OVERFLOW';
  sceneIndex: number;
  dialogueWordCount: number;
  targetDurationSeconds: number;
  estimatedDurationSeconds: number;
  message: string;
  suggestion: string;
}

const DEFAULT_SCENE_DURATION_SECONDS = 15;
const COMFORTABLE_WORDS_PER_SECOND = 2.5;

export function countDialogueWords(text: string): number {
  return text.match(/[A-Za-z0-9']+/g)?.length ?? 0;
}

export function estimateDialogueDurationSeconds(wordCount: number): number {
  return Math.ceil(wordCount / COMFORTABLE_WORDS_PER_SECOND);
}

export function checkDialogueDurationFit(input: {
  scenes?: DialogueFitScene[];
  strict?: boolean;
  defaultDurationSeconds?: number;
}): DialogueFitIssue[] {
  const issues: DialogueFitIssue[] = [];
  const defaultDurationSeconds = input.defaultDurationSeconds ?? DEFAULT_SCENE_DURATION_SECONDS;
  const strict = input.strict ?? process.env.DIRECTOR_STRICT_DIALOGUE_FIT === '1';

  for (const [index, scene] of (input.scenes ?? []).entries()) {
    const dialogue = scene.dialogue?.trim();
    if (!dialogue) continue;
    const sceneIndex = Number.isInteger(scene.sceneIndex) ? Number(scene.sceneIndex) : index;
    const targetDurationSeconds = Number.isFinite(scene.durationSeconds)
      ? Number(scene.durationSeconds)
      : defaultDurationSeconds;
    const dialogueWordCount = countDialogueWords(dialogue);
    const estimatedDurationSeconds = estimateDialogueDurationSeconds(dialogueWordCount);
    if (estimatedDurationSeconds <= targetDurationSeconds) continue;

    issues.push({
      severity: strict ? 'error' : 'warn',
      code: 'DIALOGUE_DURATION_OVERFLOW',
      sceneIndex,
      dialogueWordCount,
      targetDurationSeconds,
      estimatedDurationSeconds,
      message: `Scene ${sceneIndex + 1} dialogue needs about ${estimatedDurationSeconds}s but the clip target is ${targetDurationSeconds}s.`,
      suggestion: 'Shorten the line, split it across scenes, or increase durationSeconds before provider execution.',
    });
  }

  return issues;
}
