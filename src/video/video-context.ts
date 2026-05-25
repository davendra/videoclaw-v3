import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CHANGELOG_HEADER = '## Dated changelog';

function bootstrapContent(): string {
  return [
    '# Video Context',
    '',
    'Operational memory for this workspace. Treat as run learnings, not source code.',
    '',
    '## Provider defaults',
    '- None recorded yet.',
    '',
    '## Winning prompts',
    '- None recorded yet.',
    '',
    '## Failed prompt patterns',
    '- None recorded yet.',
    '',
    '## Style presets by brand',
    '- None recorded yet.',
    '',
    '## Cost/time benchmarks',
    '- None recorded yet.',
    '',
    CHANGELOG_HEADER,
    '- None recorded yet.',
    '',
  ].join('\n');
}

function withChangelogEntry(content: string, entry: string): string {
  const changelogBlock = `${CHANGELOG_HEADER}\n- ${entry}`;
  if (content.includes(`${CHANGELOG_HEADER}\n- None recorded yet.`)) {
    return content.replace(`${CHANGELOG_HEADER}\n- None recorded yet.`, changelogBlock);
  }
  if (content.includes(CHANGELOG_HEADER)) {
    return content.replace(CHANGELOG_HEADER, changelogBlock);
  }
  return `${content.trimEnd()}\n\n${changelogBlock}\n`;
}

export interface VideoContextPaths {
  omxDir: string;
  omxPath: string;
  vclawDir: string;
  vclawPath: string;
}

export function resolveVideoContextPaths(root = process.cwd()): VideoContextPaths {
  const normalizedRoot = resolve(root);
  return {
    omxDir: join(normalizedRoot, '.omx'),
    omxPath: join(normalizedRoot, '.omx', 'video-context.md'),
    vclawDir: join(normalizedRoot, '.vclaw'),
    vclawPath: join(normalizedRoot, '.vclaw', 'video-context.md'),
  };
}

export async function ensureVideoContext(root = process.cwd()): Promise<VideoContextPaths> {
  const paths = resolveVideoContextPaths(root);
  await mkdir(paths.omxDir, { recursive: true });

  if (!existsSync(paths.omxPath)) {
    if (existsSync(paths.vclawPath)) {
      const legacyContent = await readFile(paths.vclawPath, 'utf-8');
      await writeFile(paths.omxPath, legacyContent);
    } else {
      await writeFile(paths.omxPath, `${bootstrapContent()}\n`);
    }
  }

  return paths;
}

export async function appendVideoContextChangelog(
  root: string | undefined,
  entry: string,
): Promise<VideoContextPaths> {
  const paths = await ensureVideoContext(root);
  const current = await readFile(paths.omxPath, 'utf-8');
  const updated = withChangelogEntry(current, entry);
  await writeFile(paths.omxPath, updated.endsWith('\n') ? updated : `${updated}\n`);

  if (existsSync(paths.vclawPath)) {
    await writeFile(paths.vclawPath, updated.endsWith('\n') ? updated : `${updated}\n`);
  }

  return paths;
}
