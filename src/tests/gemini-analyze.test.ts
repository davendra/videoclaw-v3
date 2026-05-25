import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateAnalyzeOutputWithGemini } from '../video/gemini-analyze.js';

describe('generateAnalyzeOutputWithGemini', () => {
  it('builds a structured analyze artifact from a Gemini-style JSON response', async () => {
    process.env.GEMINI_API_KEYS = 'test-key';
    const artifact = await generateAnalyzeOutputWithGemini({
      source: 'https://example.com/ref.mp4',
      title: 'Reference Ad',
      durationSeconds: 30,
      endpoint: 'https://example.test/generate',
      fetcher: async (url: string | URL | Request, init?: RequestInit) => {
        const resolved = typeof url === 'string'
          ? url
          : url instanceof URL
            ? url.toString()
            : url.url;
        assert.match(resolved, /key=test-key/);
        assert.equal(init?.method, 'POST');
        return new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  pacing: { label: 'fast', notes: ['strong first-second hook'] },
                  structure: { hook: 'Immediate conflict', beats: ['hook', 'proof', 'cta'], ending: 'Brand resolve' },
                  motionClassification: { primaryMode: 'motion-clips', notes: ['mostly live action'] },
                  keep: ['fast open'],
                  change: ['product'],
                  reusableVariables: ['product', 'audience'],
                  styleLayers: ['tight creator framing'],
                  beatCompression: { targetDurationSeconds: 15, maxBeats: 3, dialogueWordBudget: 35, notes: ['shorten lines'] },
                  technicalNotes: ['vertical crop'],
                  dialogueNotes: ['one hook sentence'],
                }),
              }],
            },
          }],
        }), { status: 200 });
      },
    });

    assert.equal(artifact.reference.title, 'Reference Ad');
    assert.equal(artifact.pacing.label, 'fast');
    assert.deepEqual(artifact.structure.beats, ['hook', 'proof', 'cta']);
    assert.deepEqual(artifact.reusableVariables, ['product', 'audience']);
    assert.deepEqual(artifact.styleLayers, ['tight creator framing']);
    assert.equal(artifact.beatCompression?.dialogueWordBudget, 35);
  });
});
