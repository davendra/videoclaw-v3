import { createAnalyzeOutput } from './analyze-output.js';
import { fetchGeminiWithPool } from './gemini-key-pool.js';
import type { VideoAnalyzeOutput } from './types.js';

const DEFAULT_GEMINI_ANALYZE_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const ANALYZE_PROMPT = `You analyze reference videos for reusable ad and short-form video templates.

Return ONLY valid JSON with this exact shape:
{
  "pacing": { "label": "slow|medium|fast|mixed", "notes": ["..."] },
  "structure": { "hook": "...", "beats": ["...", "..."], "ending": "..." },
  "motionClassification": { "primaryMode": "motion-clips|animated-stills|mixed|unknown", "notes": ["..."] },
  "keep": ["..."],
  "change": ["..."],
  "reusableVariables": ["..."],
  "styleLayers": ["..."],
  "beatCompression": { "targetDurationSeconds": 15, "maxBeats": 5, "dialogueWordBudget": 35, "notes": ["..."] },
  "technicalNotes": ["..."],
  "dialogueNotes": ["..."]
}

Rules:
- Keep beats short and reusable.
- Prefer 3-6 beats.
- Capture the reusable mechanism, not copied claims or brand-specific language.
- Include style layers for casting, setting, framing, lighting, pacing, and edit rhythm when visible.
- Compress long references into a 15-second default unless the source duration clearly demands otherwise.
- "keep", "change", and "reusableVariables" should be concise production notes.
- Do not wrap the JSON in markdown fences.`;

function parseGeminiTextResponse(payload: unknown): string {
  const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates;
  const text = candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('\n')
    .trim();
  if (!text) {
    throw new Error('Gemini analyze response did not contain text output.');
  }
  return text;
}

function parseAnalyzeJson(text: string): Omit<VideoAnalyzeOutput, 'reference' | 'generatedAt'> {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(cleaned) as Partial<VideoAnalyzeOutput>;
  const beats = parsed.structure?.beats ?? [];
  if (!Array.isArray(beats) || beats.length === 0) {
    throw new Error('Gemini analyze response did not include structure.beats.');
  }
  return {
    pacing: {
      label: parsed.pacing?.label ?? 'mixed',
      notes: parsed.pacing?.notes ?? [],
    },
    structure: {
      ...(parsed.structure?.hook ? { hook: parsed.structure.hook } : {}),
      beats,
      ...(parsed.structure?.ending ? { ending: parsed.structure.ending } : {}),
    },
    motionClassification: {
      primaryMode: parsed.motionClassification?.primaryMode ?? 'unknown',
      notes: parsed.motionClassification?.notes ?? [],
    },
    keep: parsed.keep ?? [],
    change: parsed.change ?? [],
    reusableVariables: parsed.reusableVariables ?? [],
    ...(Array.isArray(parsed.styleLayers) ? { styleLayers: parsed.styleLayers } : {}),
    ...(parsed.beatCompression ? { beatCompression: parsed.beatCompression } : {}),
    ...(Array.isArray(parsed.technicalNotes) ? { technicalNotes: parsed.technicalNotes } : {}),
    ...(Array.isArray(parsed.dialogueNotes) ? { dialogueNotes: parsed.dialogueNotes } : {}),
  };
}

export async function generateAnalyzeOutputWithGemini(input: {
  source: string;
  title?: string;
  durationSeconds?: number;
  endpoint?: string;
  fetcher?: typeof fetch;
}): Promise<VideoAnalyzeOutput> {
  const endpoint = input.endpoint ?? process.env.VCLAW_GEMINI_API_ENDPOINT ?? DEFAULT_GEMINI_ANALYZE_ENDPOINT;
  const response = await fetchGeminiWithPool(
    (key) => `${endpoint}${endpoint.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'close',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `${ANALYZE_PROMPT}\n\nSource: ${input.source}\nTitle: ${input.title ?? 'Untitled reference'}\nDuration: ${input.durationSeconds ?? 'unknown'} seconds`,
          }],
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1200,
          responseMimeType: 'application/json',
        },
      }),
    },
    {
      fetcher: input.fetcher,
      onRetry: (label, status) => {
        process.stderr.write(`[analyze/gemini] ${label} returned HTTP ${status}; rotating key\n`);
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini analyze request failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  const text = parseGeminiTextResponse(payload);
  const generated = parseAnalyzeJson(text);
  return createAnalyzeOutput({
    reference: {
      source: input.source,
      ...(input.title ? { title: input.title } : {}),
      ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}),
    },
    ...generated,
  });
}
