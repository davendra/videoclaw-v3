import type { VideoAnalyzeOutput } from './types.js';

export function createAnalyzeOutput(
  input: Omit<VideoAnalyzeOutput, 'generatedAt'> & { generatedAt?: string },
): VideoAnalyzeOutput {
  return {
    ...input,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}
