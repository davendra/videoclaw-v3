import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else {
        out.push(path);
      }
    }
  }

  return out.sort();
}

describe('skills hygiene', () => {
  it('keeps shipped skill docs and helper scripts free of legacy repo/path assumptions', async () => {
    const skillsRoot = join(process.cwd(), 'skills');
    const files = (await walkFiles(skillsRoot)).filter((path) => {
      if (path.includes('/video-replicator-workspace/')) return false;
      if (path.includes('/assets/')) return false;
      // skills-auditor legitimately mentions the patterns it audits FOR
      // (e.g., '.claude/skills/...') as part of its checklist content.
      if (path.includes('/skills-auditor/')) return false;
      // skills/video-replicator/scripts/ is the 112-file Python bundle imported
      // verbatim from the source workspace; it contains code-comment references
      // to the source layout (e.g. "# .claude/skills/video-replicator/scripts/X.py"
      // as a file-banner) that are annotations, not functional paths.
      if (path.includes('/video-replicator/scripts/')) return false;
      return (
        path.endsWith('SKILL.md')
        || path.endsWith('.md')
        || path.endsWith('.sh')
        || path.endsWith('.py')
        || path.endsWith('.json')
        || path.endsWith('.yaml')
      );
    });

    const forbiddenPatterns = [
      /\.claude\/skills\//,
      /video-replicator-veo-cli/,
      /~\/videoclaw/,
      /cd \/Users\/davendrapatel\/Documents\/GitHub\/vclaw-video-core/,
      /VIDEOCLAW_ROOT=.*videoclaw/,
    ];

    const violations: Array<{ path: string; pattern: string }> = [];
    for (const path of files) {
      const content = await readFile(path, 'utf-8');
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) {
          violations.push({ path, pattern: String(pattern) });
        }
      }
    }

    assert.deepEqual(violations, []);
  });
});
