import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PreviewPortalAuditEvent } from './types.js';

export async function appendPreviewPortalAuditEvent(
  path: string,
  event: PreviewPortalAuditEvent,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`);
}

export async function readPreviewPortalAuditEvents(path: string): Promise<PreviewPortalAuditEvent[]> {
  if (!existsSync(path)) return [];
  return (await readFile(path, 'utf-8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PreviewPortalAuditEvent);
}
