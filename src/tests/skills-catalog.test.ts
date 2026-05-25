import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function listSkillIds(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await access(join(root, entry.name, 'SKILL.md'));
      ids.push(entry.name);
    } catch {
      // Not a runnable skill directory.
    }
  }
  return ids.sort();
}

describe('skills catalog', () => {
  it('matches the imported skill tree and preserves alias and specialization declarations', async () => {
    const skillsDir = join(process.cwd(), 'skills');
    const catalogPath = join(skillsDir, 'catalog.json');
    const catalog = JSON.parse(await readFile(catalogPath, 'utf-8')) as {
      skills?: Array<{
        id?: string;
        category?: string;
        status?: string;
        aliasOf?: string;
        role?: string;
        specializes?: string;
        specializations?: string[];
      }>;
    };

    const actualSkillIds = await listSkillIds(skillsDir);
    const entries = catalog.skills ?? [];
    const catalogIds = entries.map((entry) => entry.id).filter(Boolean).sort();
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));

    assert.equal(catalogIds.length, actualSkillIds.length);
    assert.deepEqual(catalogIds, actualSkillIds);
    assert.ok(entries.some((entry) => entry.id === 'brand-presenter' && entry.status === 'native-generic'));
    assert.ok(entries.some((entry) => entry.id === 'video-framework' && entry.role === 'canonical-entry'));
    assert.ok(entries.some((entry) => entry.id === 'brand-presenter' && entry.role === 'canonical-entry'));
    assert.ok(entries.some((entry) => entry.id === 'character-library' && entry.specializes === 'character-creator'));
    assert.ok(entries.some((entry) => entry.id === 'davendra-presenter' && entry.aliasOf === 'brand-presenter'));
    assert.ok(entries.some((entry) => entry.id === 'nex-presenter' && entry.aliasOf === 'brand-presenter'));
    assert.ok(entries.some((entry) => entry.id === 'bunty' && entry.aliasOf === 'brand-presenter'));
    assert.ok(entries.some((entry) => entry.id === 'movie-director' && entry.specializes === 'video-framework'));
    assert.ok(entries.some((entry) => entry.id === 'video-post' && entry.specializes === 'video-framework'));
    assert.ok(entries.some((entry) => entry.id === 'video-production-handoff' && entry.specializes === 'video-framework'));
    assert.ok(entries.some((entry) => entry.id === 'video-review-ui-qa' && entry.specializes === 'video-framework'));
    assert.ok(entries.some((entry) => entry.id === 'video-portfolio-ops' && entry.specializes === 'video-framework'));
    assert.ok(entries.some((entry) => entry.id === 'video-release-readiness' && entry.specializes === 'video-framework'));

    for (const entry of entries) {
      if (entry.aliasOf) {
        assert.ok(entryById.has(entry.aliasOf), `${entry.id} aliases missing target ${entry.aliasOf}`);
      }
      if (entry.specializes) {
        assert.ok(entryById.has(entry.specializes), `${entry.id} specializes missing target ${entry.specializes}`);
      }
      for (const specialization of entry.specializations ?? []) {
        assert.ok(entryById.has(specialization), `${entry.id} lists missing specialization ${specialization}`);
      }
      if (entry.role === 'canonical-entry') {
        assert.ok(
          entry.status === 'native-generic' || entry.id === 'video-framework',
          `${entry.id} should be a stable first-choice entry point`,
        );
      }
    }
  });
});
