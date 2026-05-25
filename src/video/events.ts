import { appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { VideoProjectWorkspace } from './workspace.js';

export interface VideoProjectEvent {
  type: string;
  recordedAt: string;
  payload?: Record<string, unknown>;
}

export async function appendProjectEvent(
  workspace: VideoProjectWorkspace,
  event: Omit<VideoProjectEvent, 'recordedAt'> & { recordedAt?: string },
): Promise<void> {
  const record: VideoProjectEvent = {
    ...event,
    recordedAt: event.recordedAt ?? new Date().toISOString(),
  };
  await appendFile(workspace.eventsPath, `${JSON.stringify(record)}\n`);
}

export async function readProjectEvents(
  workspace: VideoProjectWorkspace,
): Promise<VideoProjectEvent[]> {
  if (!existsSync(workspace.eventsPath)) return [];
  const raw = await readFile(workspace.eventsPath, 'utf-8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as VideoProjectEvent);
}
