/**
 * Background-music generation adapter (fetch-based).
 *
 * Ported from `skills/video-replicator/scripts/generate_music.py`:
 *  - Provider:     Kie.ai (Suno AI v1 API)
 *  - API base:     https://api.kie.ai
 *  - auth header:  Authorization: Bearer <KIE_API_KEY>
 *  - submit:       POST /api/v1/generate
 *                    body { prompt, customMode, instrumental, model, callBackUrl }
 *                    -> { code: 200, data: { taskId } }
 *  - poll:         GET  /api/v1/generate/record-info?taskId=<id>
 *                    -> { code: 200, data: { status, response: { sunoData: [...] } } }
 *                    status === "SUCCESS"  -> tracks ready (track.audioUrl)
 *                    status === "FAILED"   -> generation failed
 *  - download:     GET <track.audioUrl> -> raw audio bytes (mp3)
 *
 * This is a poll-based provider: submit a job, poll record-info until the
 * job reaches SUCCESS/FAILED (or we exhaust attempts), then download the
 * first track's audio. The retry/prompt-simplification ladder from the
 * Python source is intentionally NOT ported (out of scope for 3f); only the
 * core submit -> poll -> download path is here.
 *
 * Pure module: no CLI wiring (3i). Mockable via `fetch`; the poll interval
 * is injectable so tests don't wait.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { VclawError } from '../errors.js';

export const KIE_API_BASE = 'https://api.kie.ai';

/** Matches the Python defaults (config.py + generate_music.py payload). */
export const DEFAULT_MUSIC_MODEL = 'V5';
export const DEFAULT_DURATION_SEC = 30;
/** Max prompt length for non-custom mode (Python truncates to this). */
export const MAX_PROMPT_CHARS = 500;
/** config.py MUSIC_POLL_MAX_ATTEMPTS / MUSIC_POLL_INTERVAL (5 min at 5s). */
export const DEFAULT_POLL_MAX_ATTEMPTS = 60;
export const DEFAULT_POLL_INTERVAL_MS = 5000;

export interface GenerateMusicInput {
  /** Music description (BPM / genre / mood). Truncated to 500 chars. */
  prompt: string;
  /** Desired duration in seconds (default 30). Forwarded to manifest metadata. */
  durationSec?: number;
  /** Absolute path the downloaded audio is written to. */
  outputPath: string;
  /** Suno model (default "V5"). */
  model?: string;
  /** Instrumental (no vocals) — default true, matching the Python payload. */
  instrumental?: boolean;
  /** Read from KIE_API_KEY when omitted. */
  apiKey?: string;
  /** Skip all network + file I/O; return a synthetic result for dry runs. */
  dryRun?: boolean;
  /** Max number of record-info polls before timing out (default 60). */
  maxPollAttempts?: number;
  /** Delay between polls in ms (default 5000; set 0 in tests). */
  pollIntervalMs?: number;
}

export interface GenerateMusicResult {
  /** Path the audio was written to (== input.outputPath). */
  path: string;
  /** Duration in milliseconds. Prefers the track's reported duration, else
   *  the requested `durationSec`. */
  durationMs: number;
}

/** One track entry from the Kie.ai `sunoData` array. */
interface SunoTrack {
  audioUrl?: string;
  title?: string;
  /** Seconds, as a number per Kie.ai responses. */
  duration?: number;
  tags?: string;
  [key: string]: unknown;
}

/**
 * Resolve the Kie.ai API key from the explicit input or KIE_API_KEY.
 * Throws `env_var_missing` if absent (matches the Python env var).
 */
export function resolveMusicApiKey(explicit?: string): string {
  const key = explicit ?? process.env.KIE_API_KEY;
  if (!key) {
    throw new VclawError(
      'env_var_missing',
      'KIE_API_KEY is not set. Export it (e.g. `export KIE_API_KEY=...`) before generating music. Sign up at https://kie.ai.',
      { envVar: 'KIE_API_KEY' },
    );
  }
  return key;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeReadText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}

/**
 * Generate background music via Kie.ai Suno. Submits the job, polls
 * record-info to completion, downloads the first track, and writes it to
 * `outputPath`. Throws `music_gen_failed` on any non-2xx, API error code,
 * FAILED status, or poll timeout.
 */
export async function generateMusic(input: GenerateMusicInput): Promise<GenerateMusicResult> {
  const durationSec = input.durationSec ?? DEFAULT_DURATION_SEC;

  if (!input.prompt.trim()) {
    throw new VclawError('music_gen_failed', 'Cannot generate music with an empty prompt.', {});
  }

  if (input.dryRun) {
    return { path: input.outputPath, durationMs: durationSec * 1000 };
  }

  const apiKey = resolveMusicApiKey(input.apiKey);
  const model = input.model ?? DEFAULT_MUSIC_MODEL;
  const instrumental = input.instrumental ?? true;
  const maxPollAttempts = input.maxPollAttempts ?? DEFAULT_POLL_MAX_ATTEMPTS;
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // --- submit ---
  const submitBody = {
    prompt: input.prompt.slice(0, MAX_PROMPT_CHARS),
    customMode: false,
    instrumental,
    model,
    // Dummy callback: we poll instead of receiving a webhook (matches Python).
    callBackUrl: 'https://httpbin.org/post',
  };

  const submitResp = await fetch(`${KIE_API_BASE}/api/v1/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify(submitBody),
  });

  if (!submitResp.ok) {
    const detail = await safeReadText(submitResp);
    throw new VclawError(
      'music_gen_failed',
      `Kie.ai generate request failed: ${submitResp.status} ${submitResp.statusText}`,
      { status: submitResp.status, detail: detail.slice(0, 300) },
    );
  }

  const submitJson = (await submitResp.json()) as {
    code?: number;
    msg?: string;
    data?: { taskId?: string };
  };

  if (submitJson.code !== 200) {
    throw new VclawError('music_gen_failed', `Kie.ai API error: ${submitJson.msg ?? 'Unknown error'}`, {
      code: submitJson.code,
    });
  }

  const taskId = submitJson.data?.taskId;
  if (!taskId) {
    throw new VclawError('music_gen_failed', 'Kie.ai response did not include a taskId.', {});
  }

  // --- poll ---
  let track: SunoTrack | undefined;
  for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
    await sleep(pollIntervalMs);

    const statusUrl = new URL(`${KIE_API_BASE}/api/v1/generate/record-info`);
    statusUrl.searchParams.set('taskId', taskId);

    const statusResp = await fetch(statusUrl.toString(), { method: 'GET', headers });
    if (!statusResp.ok) {
      // Transient: keep polling (matches Python `continue`).
      continue;
    }

    const statusJson = (await statusResp.json()) as {
      code?: number;
      data?: {
        status?: string;
        errorMessage?: string;
        response?: { sunoData?: SunoTrack[] };
      };
    };

    if (statusJson.code !== 200) {
      // Still warming up; poll again.
      continue;
    }

    const data = statusJson.data ?? {};
    const genStatus = data.status ?? '';

    if (genStatus === 'SUCCESS') {
      const tracks = data.response?.sunoData ?? [];
      if (tracks.length > 0) {
        track = tracks[0];
        break;
      }
    }

    if (genStatus === 'FAILED' || JSON.stringify(data).includes('GENERATE_AUDIO_FAILED')) {
      throw new VclawError('music_gen_failed', `Music generation failed: ${data.errorMessage ?? 'GENERATE_AUDIO_FAILED'}`, {
        taskId,
        status: genStatus,
      });
    }
    // otherwise: pending — loop again.
  }

  if (!track) {
    throw new VclawError('music_gen_failed', `Music generation timed out after ${maxPollAttempts} polls.`, {
      taskId,
    });
  }

  const audioUrl = track.audioUrl;
  if (!audioUrl) {
    throw new VclawError('music_gen_failed', 'Completed track did not include an audioUrl.', { taskId });
  }

  // --- download ---
  const audioResp = await fetch(audioUrl, { method: 'GET' });
  if (!audioResp.ok) {
    const detail = await safeReadText(audioResp);
    throw new VclawError(
      'music_gen_failed',
      `Failed to download music track: ${audioResp.status} ${audioResp.statusText}`,
      { status: audioResp.status, detail: detail.slice(0, 300) },
    );
  }

  const bytes = new Uint8Array(await audioResp.arrayBuffer());
  const dir = dirname(input.outputPath);
  if (dir) await mkdir(dir, { recursive: true });
  await writeFile(input.outputPath, bytes);

  // Prefer the track's reported duration (seconds); fall back to requested.
  const trackDurationSec = typeof track.duration === 'number' ? track.duration : durationSec;

  return { path: input.outputPath, durationMs: Math.round(trackDurationSec * 1000) };
}
