import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface ObsidianVaultScaffoldResult {
  root: string;
  dashboardPath: string;
  templatesDir: string;
  viewsDir: string;
}

const PROJECT_TEMPLATE = `---
title: ""
slug: ""
ops_status: planned
production_mode: storyboard
next_stage: brief
completed_stage_count: 0
pending_stage_count: 5
artifact_count: 0
checkpoint_count: 0
completed_stages: []
pending_stages: []
artifact_files: []
---

# {{title}}

## Summary

- Ops status: \`planned\`
- Production mode: \`storyboard\`
- Next stage: \`brief\`

## Checkpoints

## Artifact Files
`;

const RUNBOOK_NOTE = `# Operations Runbook

## Core workflow

1. Sync projects from \`vclaw-video-core\`
2. Review \`Dashboard.md\`
3. Open blocked or active project notes
4. Update project state through CLI, then re-sync

## Suggested cadence

1. Morning: run \`vclaw video sync-obsidian\`
2. Midday: review blocked projects
3. End of day: re-sync and archive completed work
`;

const KANBAN_GUIDE = `# Board Guide

Recommended Obsidian groupings:

1. \`ops_status\`
2. \`production_mode\`
3. \`next_stage\`

Recommended statuses:

1. \`planned\`
2. \`active\`
3. \`needs-review\`
4. \`blocked\`
5. \`complete\`
`;

export async function scaffoldObsidianVault(
  outputDir: string,
): Promise<ObsidianVaultScaffoldResult> {
  const root = resolve(outputDir);
  const projectsDir = join(root, 'Projects');
  const templatesDir = join(root, 'Templates');
  const viewsDir = join(root, 'Views');
  const dashboardPath = join(root, 'Dashboard.md');

  await mkdir(projectsDir, { recursive: true });
  await mkdir(templatesDir, { recursive: true });
  await mkdir(viewsDir, { recursive: true });

  await writeFile(dashboardPath, '# Production Dashboard\n\nRun `vclaw video sync-obsidian` to populate this vault.\n');
  await writeFile(join(templatesDir, 'Project Template.md'), PROJECT_TEMPLATE);
  await writeFile(join(viewsDir, 'Operations Runbook.md'), RUNBOOK_NOTE);
  await writeFile(join(viewsDir, 'Board Guide.md'), KANBAN_GUIDE);

  return {
    root,
    dashboardPath,
    templatesDir,
    viewsDir,
  };
}
