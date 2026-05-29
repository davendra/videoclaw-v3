import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_RECIPES } from '../video/studio/recipes.js';
import type { StudioGoal } from '../video/studio/types.js';

describe('studio recipes', () => {
  it('covers every public studio goal', () => {
    const ids = new Set(STUDIO_RECIPES.map((recipe) => recipe.id));
    const expectedGoals: StudioGoal[] = [
      'create-video',
      'copy-reference',
      'presenter-video',
      'music-video',
      'ugc-campaign',
      'existing-project',
      'review-regenerate',
      'publish-deliver',
    ];
    for (const expected of expectedGoals) {
      assert.ok(ids.has(expected), `missing studio recipe ${expected}`);
    }
  });

  it('each recipe has command steps and safe execution policy metadata', () => {
    for (const recipe of STUDIO_RECIPES) {
      assert.ok(recipe.title.length > 0, `${recipe.id} needs a title`);
      assert.ok(recipe.goal.length > 0, `${recipe.id} needs a goal`);
      assert.ok(recipe.commands.length > 0, `${recipe.id} needs commands`);
      assert.match(recipe.executionPolicy, /dry-run|plan-first|approval-gated/);
      assert.ok(['low', 'medium', 'high'].includes(recipe.riskLevel));
    }
  });

  it('does not expose raw Python or shell scripts as primary commands', () => {
    for (const recipe of STUDIO_RECIPES) {
      for (const command of recipe.commands) {
        assert.equal(
          command.primary.startsWith('python '),
          false,
          `${recipe.id} should wrap python scripts behind vclaw commands`,
        );
        assert.equal(
          command.primary.startsWith('bash skills/'),
          false,
          `${recipe.id} should wrap shell scripts behind vclaw commands`,
        );
      }
    }
  });
});
