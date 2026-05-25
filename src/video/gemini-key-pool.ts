const DEFAULT_COOLDOWN_MS = 60_000;

interface KeyState {
  key: string;
  cooldownUntil: number;
  label: string;
}

let pool: KeyState[] | null = null;
let roundRobinIndex = 0;

function loadPool(): KeyState[] {
  if (pool !== null) return pool;

  const sources = [
    process.env.GEMINI_API_KEYS,
    process.env.GOOGLE_API_KEYS,
    process.env.GOOGLE_API_KEY,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  const seen = new Set<string>();
  const keys: string[] = [];
  for (const source of sources) {
    for (const raw of source.split(/[,;\n\s]+/)) {
      const key = raw.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }

  pool = keys.map((key, index) => ({
    key,
    cooldownUntil: 0,
    label: `k${index + 1}[${key.slice(0, 6)}…]`,
  }));

  if (pool.length > 1) {
    process.stderr.write(
      `[gemini-pool] Loaded ${pool.length} keys: ${pool.map((entry) => entry.label).join(', ')}\n`,
    );
  }

  return pool;
}

export function getPoolSize(): number {
  return loadPool().length;
}

export function getPoolLabels(): string[] {
  return loadPool().map((entry) => entry.label);
}

export async function nextAvailableKey(): Promise<{ key: string; label: string } | undefined> {
  const entries = loadPool();
  if (entries.length === 0) return undefined;

  const now = Date.now();
  for (let offset = 0; offset < entries.length; offset += 1) {
    const index = (roundRobinIndex + offset) % entries.length;
    const entry = entries[index];
    if (entry.cooldownUntil <= now) {
      roundRobinIndex = (index + 1) % entries.length;
      return { key: entry.key, label: entry.label };
    }
  }

  const soonest = entries.reduce((current, candidate) =>
    candidate.cooldownUntil < current.cooldownUntil ? candidate : current,
  );
  const waitMs = Math.max(0, soonest.cooldownUntil - now);
  if (waitMs > 0) {
    process.stderr.write(
      `[gemini-pool] All ${entries.length} keys cooling; waiting ${Math.round(waitMs / 1000)}s for ${soonest.label}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs + 100));
  }
  soonest.cooldownUntil = 0;
  return { key: soonest.key, label: soonest.label };
}

export function markKeyRateLimited(key: string, durationMs: number = DEFAULT_COOLDOWN_MS): void {
  const entries = loadPool();
  const entry = entries.find((candidate) => candidate.key === key);
  if (!entry) return;
  entry.cooldownUntil = Date.now() + durationMs;
  process.stderr.write(
    `[gemini-pool] ${entry.label} rate-limited — cooling for ${Math.round(durationMs / 1000)}s\n`,
  );
}

export async function fetchGeminiWithPool(
  buildUrl: (key: string) => string,
  init: RequestInit,
  options: {
    maxAttempts?: number;
    onRetry?: (label: string, status: number) => void;
    fetcher?: typeof fetch;
  } = {},
): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? Math.max(4, getPoolSize() + 2);
  const fetcher = options.fetcher ?? fetch;
  let lastStatus = 0;
  let lastBody = '';

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const picked = await nextAvailableKey();
    if (!picked) {
      throw new Error('No Gemini API keys configured (set GEMINI_API_KEYS or GOOGLE_API_KEY)');
    }

    const response = await fetcher(buildUrl(picked.key), init);
    if (response.ok) return response;

    const retryable = response.status === 429 || response.status === 503 || response.status >= 500;
    if (retryable && attempt < maxAttempts - 1) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const cooldownMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : DEFAULT_COOLDOWN_MS;
      markKeyRateLimited(picked.key, cooldownMs);
      options.onRetry?.(picked.label, response.status);
      lastStatus = response.status;
      lastBody = await response.text().catch(() => '');
      continue;
    }

    return response;
  }

  return new Response(lastBody, { status: lastStatus, statusText: 'Retries exhausted' });
}

export function _resetPoolForTests(): void {
  pool = null;
  roundRobinIndex = 0;
}
