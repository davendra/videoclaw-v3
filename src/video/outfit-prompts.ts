/**
 * Two-reference outfit swap. Order is FIXED: @image1 = outfit/pose,
 * @image2 = character/identity. Reversing breaks the swap. Lean prompt only —
 * NO cinema stack appended (the references carry the photographic register).
 * Prompt-emitter only: the operator pastes this into the external image tool.
 */
export function outfitSwapPrompt(): string {
  return 'Replace the character in @image1 with the character in @image2. Keep the outfit and pose from @image1 exactly. Match the face, bone structure, body type, skin tone, and hair from @image2. Even neutral mid-gray seamless background, soft large-source studio lighting, skin and outfit at their true natural tone against the neutral gray, natural film grain, full body framing.';
}

/** Step 1 of the two-step build: design the outfit on a bland generic model. */
export function outfitBuildPrompt(outfit: string): string {
  return `Build this outfit on a bland generic slim model (no specific identity): ${outfit}. The outfit is the only subject. Even neutral mid-gray seamless background, soft studio lighting, full body framing, natural film grain.`;
}
