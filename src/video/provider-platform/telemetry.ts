import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  TelemetryVerdict,
  VideoRunTelemetryRecord,
  VideoWorkflowKind,
} from "./types.js";

export function createTelemetryRecord(
  input: Omit<VideoRunTelemetryRecord, "recordedAt">
): VideoRunTelemetryRecord {
  return {
    ...input,
    recordedAt: new Date().toISOString(),
  };
}

export function appendTelemetryRecord(
  logPath: string,
  record: VideoRunTelemetryRecord
): void {
  mkdirSync(dirname(logPath), { recursive: true });
  const sanitized = sanitizeTelemetryRecord(record);
  appendFileSync(logPath, `${JSON.stringify(sanitized)}\n`, "utf8");
}

export function readTelemetryRecords(logPath: string): VideoRunTelemetryRecord[] {
  if (!existsSync(logPath)) {
    return [];
  }

  return readFileSync(logPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as VideoRunTelemetryRecord);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarizeTelemetry(records: VideoRunTelemetryRecord[]) {
  const byWorkflow = new Map<VideoWorkflowKind, VideoRunTelemetryRecord[]>();

  for (const record of records) {
    const workflowRecords = byWorkflow.get(record.workflow) ?? [];
    workflowRecords.push(record);
    byWorkflow.set(record.workflow, workflowRecords);
  }

  return {
    totalRuns: records.length,
    acceptedRuns: records.filter((record) => record.verdict === "accepted").length,
    averageLatencyMs: average(records.map((record) => record.latencyMs)),
    averageRetries: average(records.map((record) => record.retryCount)),
    byWorkflow: Array.from(byWorkflow.entries()).map(([workflow, workflowRecords]) => ({
      workflow,
      runs: workflowRecords.length,
      accepted: workflowRecords.filter((record) => record.verdict === "accepted").length,
      averageLatencyMs: average(workflowRecords.map((record) => record.latencyMs)),
    })),
  };
}

export function markVerdict(
  record: VideoRunTelemetryRecord,
  verdict: TelemetryVerdict,
  failureCause?: string
): VideoRunTelemetryRecord {
  return {
    ...record,
    verdict,
    failureCause,
  };
}

const SECRET_ENV_KEYS = [
  'USEAPI_API_TOKEN',
  'GOOGLE_API_KEY',
  'ELEVENLABS_API_KEY',
  'KIE_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
];

/**
 * Sanitize a telemetry record by redacting any metadata values
 * that match known secret env var values. Prevents accidental
 * secret leakage in telemetry logs.
 */
export function sanitizeTelemetryRecord(
  record: VideoRunTelemetryRecord,
): VideoRunTelemetryRecord {
  if (!record.metadata) return record;

  const secretValues = new Set(
    SECRET_ENV_KEYS
      .map(key => process.env[key])
      .filter((val): val is string => typeof val === 'string' && val.length > 0),
  );

  if (secretValues.size === 0) return record;

  const sanitizedMetadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record.metadata)) {
    if (typeof value === 'string' && secretValues.has(value)) {
      sanitizedMetadata[key] = '[REDACTED]';
    } else {
      sanitizedMetadata[key] = value;
    }
  }

  return { ...record, metadata: sanitizedMetadata };
}
