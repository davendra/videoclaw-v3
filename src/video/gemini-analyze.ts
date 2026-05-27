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

// Authors a multi-shot cinematic prompt body via Gemini.
// Requires GEMINI_API_KEYS (or GOOGLE_API_KEYS / GOOGLE_API_KEY) to be set.
// The stub path (VCLAW_MULTISHOT_AUTO_STUB) is handled upstream in
// generateMultiShotPromptText; this function is only called for the live path.
export async function generateMultiShotWithGemini(input: {
  preset: import('./multi-shot-prompt.js').MultiShotPreset;
  imagePath: string;
  character?: string;
  action?: string;
  location: string;
  timeOfDay: string;
}): Promise<string> {
  const endpoint =
    process.env.VCLAW_GEMINI_API_ENDPOINT ?? DEFAULT_GEMINI_ANALYZE_ENDPOINT;
  const brief = [
    `Preset: ${input.preset.name} (${input.preset.totalSeconds}s total, ${input.preset.minShotSeconds}-${input.preset.maxShotSeconds}s per shot, max ${input.preset.maxChars} chars)`,
    `Style: ${input.preset.styleLine}`,
    `Audio: ${input.preset.audioLine}`,
    `Location: ${input.location}, ${input.timeOfDay}`,
    ...(input.character ? [`Character: ${input.character}`] : []),
    ...(input.action ? [`Action: ${input.action}`] : []),
    `Image reference: ${input.imagePath}`,
  ].join('\n');
  const promptText = `You are a cinematographer authoring a compressed timecoded multi-shot prompt for an AI video generator.\n\nRules:\n- Use timecodes in [MM:SS - MM:SS] format, contiguous from 00:00 to ${String(Math.floor(input.preset.totalSeconds / 60)).padStart(2,'0')}:${String(input.preset.totalSeconds % 60).padStart(2,'0')}\n- Each shot: ${input.preset.minShotSeconds}-${input.preset.maxShotSeconds}s; vary shot size, lens, angle, movement shot-to-shot (never repeat consecutively)\n- End with three metadata lines: Location, Style, Audio\n- Total prompt under ${input.preset.maxChars} characters\n- Return ONLY the prompt body, no explanation\n\nBrief:\n${brief}`;

  if (!process.env.GEMINI_API_KEYS && !process.env.GOOGLE_API_KEYS && !process.env.GOOGLE_API_KEY) {
    throw new Error(
      'multi-shot --auto requires VCLAW_MULTISHOT_AUTO_STUB (stub/test path) or a configured Gemini key pool (GEMINI_API_KEYS / GOOGLE_API_KEYS / GOOGLE_API_KEY)',
    );
  }

  const response = await fetchGeminiWithPool(
    (key) => `${endpoint}${endpoint.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 800,
          responseMimeType: 'text/plain',
        },
      }),
    },
    {
      onRetry: (label, status) => {
        process.stderr.write(`[multi-shot/gemini] ${label} returned HTTP ${status}; rotating key\n`);
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini multi-shot request failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  return parseGeminiTextResponse(payload).trim();
}
