import { listProjects } from './projects.js';
import { readProjectEvents } from './events.js';
import { resolveProjectWorkspace } from './workspace.js';

export interface VideoTimelineEvent {
  slug: string;
  type: string;
  recordedAt: string;
  payload?: Record<string, unknown>;
}

export async function buildTimeline(
  root = process.cwd(),
): Promise<VideoTimelineEvent[]> {
  const slugs = await listProjects(root);
  const events: VideoTimelineEvent[] = [];

  for (const slug of slugs) {
    const workspace = resolveProjectWorkspace(slug, root);
    const projectEvents = await readProjectEvents(workspace);
    for (const event of projectEvents) {
      events.push({
        slug,
        type: event.type,
        recordedAt: event.recordedAt,
        payload: event.payload,
      });
    }
  }

  return events.sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
}
