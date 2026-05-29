# Studio Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a friendly `vclaw studio` front door that turns the current CLI, skills, and legacy scripts into guided production workflows without weakening the existing agent-friendly JSON contract.

**Architecture:** Build a pure TypeScript Studio planning layer first: capability registry -> recipe planner -> command plan -> optional session artifact. The CLI exposes the planner as `vclaw studio --dry-run` and `vclaw studio --goal <goal> ...`; interactive prompt rendering is added only after the deterministic planner is covered by tests. Raw Python/shell scripts stay behind capability metadata and are not invoked directly by the first slice.

**Tech Stack:** Existing TypeScript NodeNext ESM, `node:test`, `assert/strict`, current `vclaw` CLI helpers, zero new runtime dependencies for Phase 1. Phase 2 may add `@inquirer/prompts` only after an explicit dependency approval because this repo currently says no new dependencies without request.

**Source research:** `docs/UNIFICATION_AUDIT.md`, `skills/video-framework/SKILL.md`, `skills/video-replicator/SKILL.md`, `skills/movie-director/SKILL.md`, current `vclaw schema --json`, script inventory under `skills/**/scripts`.

**Effort target:** 5-7 focused commits for Phase 1, then 2-3 commits for optional interactive menus.

---

## Requirements Summary

- Give humans one obvious entrypoint: `vclaw studio`.
- Keep the existing agent contract intact: JSON when piped, progress on stderr, stable exit codes.
- Do not expose the 158 raw script files as the primary UX.
- Map user goals to production recipes: create, copy/reference, presenter, music video, UGC, existing project, review/regenerate, publish.
- Start with dry-run plan generation before any provider spend or file mutation.
- Reuse current canonical commands where possible: `video create`, `clone-plan`, `filmmaking-prompts`, `multi-shot`, `readiness`, `next-actions`, `portal`, `publish-preview`, `assemble`.
- Treat Python/shell scripts as legacy capabilities with metadata, not direct public front doors.
- Make the planning layer pure and testable before adding prompt UI.

## Acceptance Criteria

- `vclaw schema --json` lists `studio` and its flags.
- `vclaw studio --dry-run --goal presenter-video --project demo --input deck.pdf --client "Acme"` returns a JSON plan when stdout is piped.
- `vclaw studio --dry-run --goal existing-project --project demo` inspects the project and includes readiness/next-action command suggestions.
- `vclaw studio --dry-run --goal music-video --project demo --duration 60` suggests `filmmaking-prompts`, storyboard grid, readiness, execute, review, and portal steps.
- Every Studio recipe has an id, title, mode, required inputs, optional inputs, commands, risk level, and execution policy.
- No Studio command executes provider calls unless a later task explicitly adds `--execute`.
- Phase 1 adds no new npm dependencies.
- Full `npm test` passes.

## File Structure

**New files:**

- `src/video/studio/types.ts` — exported Studio domain types: goals, capabilities, recipes, answers, plan steps, session artifact.
- `src/video/studio/recipes.ts` — curated recipe catalog for create, copy/reference, presenter, music-video, UGC, existing project, review, publish.
- `src/video/studio/planner.ts` — pure `buildStudioPlan(input)` function that returns command plans without side effects.
- `src/video/studio/project-context.ts` — helper that loads project existence/readiness/next actions when a project is supplied.
- `src/video/studio/session.ts` — optional writer/reader for `artifacts/studio-session.json` after dry-run planning is stable.
- `src/tests/studio-recipes.test.ts` — validates recipe catalog completeness and no raw-script-only public paths.
- `src/tests/studio-planner.test.ts` — validates deterministic plan generation for each top-level goal.
- `src/tests/cli-studio.test.ts` — spawn-based CLI tests for JSON output, missing inputs, and schema presence.
- `docs/STUDIO.md` — operator guide for `vclaw studio`.

**Modified files:**

- `src/cli/vclaw.ts` — import Studio planner, add help text, route top-level `studio`, parse flags, write output through `writeOutput`.
- `src/video/cli-schema.ts` — add `studio` command contract.
- `docs/CLI_REFERENCE.md` — document `vclaw studio`.
- `docs/PRODUCTION_WORKFLOW.md` — point humans at Studio as the recommended front door.
- `skills/video-framework/SKILL.md` — reference `vclaw studio --dry-run` as the CLI planning surface.
- `package.json` — only modified in Phase 2 if `@inquirer/prompts` is approved.

---

## Phase 1: Deterministic Studio Planner

### Task 1: Add Studio Types And Recipe Catalog

**Files:**
- Create: `src/video/studio/types.ts`
- Create: `src/video/studio/recipes.ts`
- Create: `src/tests/studio-recipes.test.ts`

- [ ] **Step 1.1: Write the failing recipe catalog test**

Create `src/tests/studio-recipes.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_RECIPES } from '../video/studio/recipes.js';

describe('studio recipes', () => {
  it('covers every public studio goal', () => {
    const ids = new Set(STUDIO_RECIPES.map((recipe) => recipe.id));
    for (const expected of [
      'create-video',
      'copy-reference',
      'presenter-video',
      'music-video',
      'ugc-campaign',
      'existing-project',
      'review-regenerate',
      'publish-deliver',
    ]) {
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
```

- [ ] **Step 1.2: Run the failing test**

Run:

```bash
npm run build && node --test dist/tests/studio-recipes.test.js
```

Expected: fail because `../video/studio/recipes.js` does not exist.

- [ ] **Step 1.3: Add Studio domain types**

Create `src/video/studio/types.ts`:

```typescript
export type StudioGoal =
  | 'create-video'
  | 'copy-reference'
  | 'presenter-video'
  | 'music-video'
  | 'ugc-campaign'
  | 'existing-project'
  | 'review-regenerate'
  | 'publish-deliver';

export type StudioRiskLevel = 'low' | 'medium' | 'high';

export interface StudioCommandTemplate {
  id: string;
  title: string;
  primary: string;
  when: string;
  produces: string[];
}

export interface StudioRecipe {
  id: StudioGoal;
  title: string;
  goal: string;
  useWhen: string[];
  requiredInputs: string[];
  optionalInputs: string[];
  commands: StudioCommandTemplate[];
  riskLevel: StudioRiskLevel;
  executionPolicy: 'dry-run-first' | 'plan-first' | 'approval-gated';
}

export interface StudioPlanInput {
  goal?: StudioGoal;
  project?: string;
  title?: string;
  intent?: string;
  input?: string;
  client?: string;
  durationSeconds?: number;
  dryRun: boolean;
  root: string;
}

export interface StudioPlanStep {
  id: string;
  title: string;
  command: string;
  reason: string;
  produces: string[];
  requiresApproval: boolean;
}

export interface StudioPlan {
  schemaVersion: 1;
  dryRun: boolean;
  goal: StudioGoal;
  title: string;
  summary: string;
  missingInputs: string[];
  warnings: string[];
  steps: StudioPlanStep[];
  nextAction: string;
}
```

- [ ] **Step 1.4: Add the initial recipe catalog**

Create `src/video/studio/recipes.ts` with these recipes:

```typescript
import type { StudioRecipe } from './types.js';

export const STUDIO_RECIPES: StudioRecipe[] = [
  {
    id: 'create-video',
    title: 'Create New Video',
    goal: 'Create an original video from a brief, references, or scratch concept.',
    useWhen: ['product ad', 'brand film', 'short film', 'explainer', 'new video'],
    requiredInputs: ['project', 'intent'],
    optionalInputs: ['title', 'durationSeconds', 'client'],
    riskLevel: 'medium',
    executionPolicy: 'dry-run-first',
    commands: [
      {
        id: 'create-dry-run',
        title: 'Draft production plan',
        primary: 'vclaw video create <intent> --project <project> --dry-run',
        when: 'always',
        produces: ['brief.json', 'storyboard.json', 'execution profile preview'],
      },
      {
        id: 'readiness',
        title: 'Check project readiness',
        primary: 'vclaw video readiness --project <project>',
        when: 'after brief and storyboard exist',
        produces: ['readiness.json'],
      },
    ],
  },
  {
    id: 'copy-reference',
    title: 'Copy Or Adapt Reference',
    goal: 'Analyze a reference video or ad and adapt it for a new subject.',
    useWhen: ['copy ad', 'clone reel', 'reference video', 'replicate'],
    requiredInputs: ['project', 'input', 'intent'],
    optionalInputs: ['client'],
    riskLevel: 'medium',
    executionPolicy: 'plan-first',
    commands: [
      {
        id: 'analyze-reference',
        title: 'Analyze source reference',
        primary: 'vclaw video analyze --project <project> --source <input> --auto',
        when: 'reference source is available',
        produces: ['analyze-output.json'],
      },
      {
        id: 'clone-plan',
        title: 'Build clone plan',
        primary: 'vclaw video clone-plan --template <template> --project <project> --intent <intent>',
        when: 'analysis has produced or selected a template',
        produces: ['clone-plan.json'],
      },
    ],
  },
  {
    id: 'presenter-video',
    title: 'Presenter Video',
    goal: 'Create a Bunty, Nex, Davendra, or generic presenter episode from a deck or brief.',
    useWhen: ['Bunty', 'Nex', 'Davendra', 'presenter', 'slides', 'deck'],
    requiredInputs: ['project', 'input'],
    optionalInputs: ['client', 'title', 'intent'],
    riskLevel: 'medium',
    executionPolicy: 'approval-gated',
    commands: [
      {
        id: 'assemble-dry-run',
        title: 'Plan presenter assembly',
        primary: 'vclaw video assemble --project <project> --dry-run',
        when: 'slides or project assets exist',
        produces: ['assemble-report.json'],
      },
      {
        id: 'portal',
        title: 'Create review portal',
        primary: 'vclaw video portal --project <project> --client <client> --surface review',
        when: 'reviewable media exists',
        produces: ['preview portal HTML'],
      },
    ],
  },
  {
    id: 'music-video',
    title: 'Music Video And Multi-Shot',
    goal: 'Plan a music-video or cinematic sequence using prompt packets, storyboard grids, and multi-shot prompts.',
    useWhen: ['music video', 'multi-shot', 'cinematic sequence', 'Seedance'],
    requiredInputs: ['project'],
    optionalInputs: ['durationSeconds', 'intent', 'input'],
    riskLevel: 'high',
    executionPolicy: 'approval-gated',
    commands: [
      {
        id: 'filmmaking-prompts',
        title: 'Generate filmmaking prompt packet',
        primary: 'vclaw video filmmaking-prompts --project <project> --duration <durationSeconds> --storyboard-grid artifacts/storyboard-grid.png --write',
        when: 'storyboard exists or a project concept exists',
        produces: ['filmmaking-prompts.json', 'storyboard-grid.png'],
      },
      {
        id: 'multi-shot',
        title: 'Create multi-shot prompt',
        primary: 'vclaw video multi-shot --from-storyboard --project <project> --scene 0 --preset cinematic-15s',
        when: 'storyboard scene exists',
        produces: ['multi-shot-prompt.json'],
      },
    ],
  },
  {
    id: 'ugc-campaign',
    title: 'UGC Campaign',
    goal: 'Plan a belief-driven campaign with hooks, scripts, variants, and assembly.',
    useWhen: ['UGC', 'testimonial', 'campaign', 'creator ad'],
    requiredInputs: ['project', 'intent'],
    optionalInputs: ['input', 'client'],
    riskLevel: 'medium',
    executionPolicy: 'plan-first',
    commands: [
      {
        id: 'ugc-brief',
        title: 'Create UGC brief',
        primary: 'vclaw video create <intent> --project <project> --production-mode director --platform tiktok --dry-run',
        when: 'campaign idea is known',
        produces: ['brief.json', 'storyboard.md'],
      },
    ],
  },
  {
    id: 'existing-project',
    title: 'Continue Existing Project',
    goal: 'Inspect a project and recommend the next action based on artifacts and readiness.',
    useWhen: ['continue', 'status', 'what next', 'existing project'],
    requiredInputs: ['project'],
    optionalInputs: ['client'],
    riskLevel: 'low',
    executionPolicy: 'dry-run-first',
    commands: [
      {
        id: 'status',
        title: 'Read project status',
        primary: 'vclaw video status --project <project>',
        when: 'project exists',
        produces: ['status report'],
      },
      {
        id: 'next-actions',
        title: 'Recommend next actions',
        primary: 'vclaw video next-actions',
        when: 'project exists',
        produces: ['portfolio next actions'],
      },
    ],
  },
  {
    id: 'review-regenerate',
    title: 'Review Or Regenerate',
    goal: 'Review generated scenes, select candidates, reroll weak scenes, and prepare approval.',
    useWhen: ['review', 'regenerate', 'reroll', 'fix scene', 'approve'],
    requiredInputs: ['project'],
    optionalInputs: ['client'],
    riskLevel: 'medium',
    executionPolicy: 'approval-gated',
    commands: [
      {
        id: 'review-ui',
        title: 'Open review UI',
        primary: 'vclaw video review-ui --project <project> --dry-run',
        when: 'project has reviewable artifacts',
        produces: ['review-ui plan'],
      },
      {
        id: 'candidates-list',
        title: 'List scene candidates',
        primary: 'vclaw video candidates-list --project <project>',
        when: 'scene candidates exist',
        produces: ['candidate summary'],
      },
    ],
  },
  {
    id: 'publish-deliver',
    title: 'Publish And Deliver',
    goal: 'Package final media and publish a client review or delivery portal.',
    useWhen: ['publish', 'client portal', 'deliver', 'share'],
    requiredInputs: ['project', 'client'],
    optionalInputs: ['input'],
    riskLevel: 'medium',
    executionPolicy: 'approval-gated',
    commands: [
      {
        id: 'portal',
        title: 'Build portal',
        primary: 'vclaw video portal --project <project> --client <client> --surface client-review',
        when: 'reviewable project exists',
        produces: ['client review portal'],
      },
      {
        id: 'publish-preview-dry-run',
        title: 'Plan portal publishing',
        primary: 'vclaw video publish-preview --project <project> --client <client> --bucket <bucket> --dry-run',
        when: 'bucket is known',
        produces: ['publish plan'],
      },
    ],
  },
];
```

- [ ] **Step 1.5: Run the recipe test**

Run:

```bash
npm run build && node --test dist/tests/studio-recipes.test.js
```

Expected: pass.

### Task 2: Add Pure Studio Planner

**Files:**
- Create: `src/video/studio/planner.ts`
- Create: `src/tests/studio-planner.test.ts`

- [ ] **Step 2.1: Write planner tests for deterministic command generation**

Create `src/tests/studio-planner.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildStudioPlan } from '../video/studio/planner.js';

describe('buildStudioPlan', () => {
  it('builds a presenter plan without executing anything', () => {
    const plan = buildStudioPlan({
      goal: 'presenter-video',
      project: 'demo',
      input: 'deck.pdf',
      client: 'Acme',
      dryRun: true,
      root: process.cwd(),
    });

    assert.equal(plan.schemaVersion, 1);
    assert.equal(plan.goal, 'presenter-video');
    assert.equal(plan.dryRun, true);
    assert.equal(plan.missingInputs.length, 0);
    assert.ok(plan.steps.some((step) => step.command === 'vclaw video assemble --project demo --dry-run'));
    assert.ok(plan.steps.some((step) => step.command.includes('--client Acme')));
  });

  it('reports missing required inputs instead of guessing', () => {
    const plan = buildStudioPlan({
      goal: 'copy-reference',
      project: 'demo',
      dryRun: true,
      root: process.cwd(),
    });

    assert.deepEqual(plan.missingInputs, ['input', 'intent']);
    assert.equal(plan.steps.length, 0);
    assert.match(plan.nextAction, /Provide input and intent/);
  });

  it('defaults to existing-project when no goal is supplied but a project is supplied', () => {
    const plan = buildStudioPlan({
      project: 'demo',
      dryRun: true,
      root: process.cwd(),
    });

    assert.equal(plan.goal, 'existing-project');
    assert.ok(plan.steps.some((step) => step.command === 'vclaw video status --project demo'));
  });

  it('builds music-video plans with prompt packet and multi-shot steps', () => {
    const plan = buildStudioPlan({
      goal: 'music-video',
      project: 'dhuaan',
      durationSeconds: 60,
      dryRun: true,
      root: process.cwd(),
    });

    assert.equal(plan.goal, 'music-video');
    assert.ok(plan.steps.some((step) => step.command.includes('filmmaking-prompts')));
    assert.ok(plan.steps.some((step) => step.command.includes('multi-shot')));
    assert.ok(plan.warnings.some((warning) => warning.includes('provider credits')));
  });
});
```

- [ ] **Step 2.2: Run the failing planner test**

Run:

```bash
npm run build && node --test dist/tests/studio-planner.test.js
```

Expected: fail because `planner.ts` does not exist.

- [ ] **Step 2.3: Implement the pure planner**

Create `src/video/studio/planner.ts`:

```typescript
import { STUDIO_RECIPES } from './recipes.js';
import type { StudioGoal, StudioPlan, StudioPlanInput, StudioPlanStep } from './types.js';

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9._/:=-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function resolveGoal(input: StudioPlanInput): StudioGoal {
  if (input.goal) return input.goal;
  if (input.project) return 'existing-project';
  return 'create-video';
}

function fillTemplate(template: string, input: StudioPlanInput): string {
  return template
    .replaceAll('<project>', input.project ? shellQuote(input.project) : '<project>')
    .replaceAll('<intent>', input.intent ? shellQuote(input.intent) : '<intent>')
    .replaceAll('<input>', input.input ? shellQuote(input.input) : '<input>')
    .replaceAll('<client>', input.client ? shellQuote(input.client) : '<client>')
    .replaceAll('<durationSeconds>', String(input.durationSeconds ?? 60));
}

export function buildStudioPlan(input: StudioPlanInput): StudioPlan {
  const goal = resolveGoal(input);
  const recipe = STUDIO_RECIPES.find((item) => item.id === goal);
  if (!recipe) {
    throw new Error(`Unknown studio goal: ${goal}`);
  }

  const missingInputs = recipe.requiredInputs.filter((name) => {
    if (name === 'project') return !input.project;
    if (name === 'intent') return !input.intent;
    if (name === 'input') return !input.input;
    if (name === 'client') return !input.client;
    return false;
  });

  const warnings: string[] = [];
  if (recipe.riskLevel === 'high') {
    warnings.push('This recipe can lead to provider credits being spent after approval; keep dry-run until assets and prompts are reviewed.');
  }
  if (!input.dryRun) {
    warnings.push('Phase 1 studio planner is plan-only; execution is intentionally not enabled yet.');
  }

  const steps: StudioPlanStep[] = missingInputs.length > 0
    ? []
    : recipe.commands.map((command) => ({
        id: command.id,
        title: command.title,
        command: fillTemplate(command.primary, input),
        reason: command.when,
        produces: command.produces,
        requiresApproval: recipe.executionPolicy === 'approval-gated',
      }));

  return {
    schemaVersion: 1,
    dryRun: true,
    goal,
    title: recipe.title,
    summary: recipe.goal,
    missingInputs,
    warnings,
    steps,
    nextAction: missingInputs.length > 0
      ? `Provide ${missingInputs.join(' and ')} to build this studio plan.`
      : 'Review the plan. Run the listed commands manually or continue to an approved execution slice.',
  };
}
```

- [ ] **Step 2.4: Run the planner tests**

Run:

```bash
npm run build && node --test dist/tests/studio-planner.test.js
```

Expected: pass.

### Task 3: Wire `vclaw studio --dry-run`

**Files:**
- Modify: `src/cli/vclaw.ts`
- Modify: `src/video/cli-schema.ts`
- Create: `src/tests/cli-studio.test.ts`

- [ ] **Step 3.1: Write CLI tests**

Create `src/tests/cli-studio.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

describe('vclaw studio cli', () => {
  it('prints JSON plan when stdout is piped', () => {
    const r = spawnSync(process.execPath, [
      cliPath,
      'studio',
      '--dry-run',
      '--goal',
      'presenter-video',
      '--project',
      'demo',
      '--input',
      'deck.pdf',
      '--client',
      'Acme',
    ], { encoding: 'utf-8' });

    assert.equal(r.status, 0, r.stderr);
    const payload = JSON.parse(r.stdout) as { goal: string; steps: Array<{ command: string }> };
    assert.equal(payload.goal, 'presenter-video');
    assert.ok(payload.steps.some((step) => step.command.includes('assemble')));
  });

  it('returns a plan with missing inputs rather than throwing for incomplete goals', () => {
    const r = spawnSync(process.execPath, [
      cliPath,
      'studio',
      '--dry-run',
      '--goal',
      'copy-reference',
      '--project',
      'demo',
    ], { encoding: 'utf-8' });

    assert.equal(r.status, 0, r.stderr);
    const payload = JSON.parse(r.stdout) as { missingInputs: string[] };
    assert.deepEqual(payload.missingInputs, ['input', 'intent']);
  });

  it('schema lists studio', () => {
    const r = spawnSync(process.execPath, [cliPath, 'schema', '--json'], { encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stderr);
    const dump = JSON.parse(r.stdout) as { commands: Array<{ name: string }> };
    assert.ok(dump.commands.some((command) => command.name === 'studio'));
  });
});
```

- [ ] **Step 3.2: Run the failing CLI test**

Run:

```bash
npm run build && node --test dist/tests/cli-studio.test.js
```

Expected: fail because `studio` is not routed.

- [ ] **Step 3.3: Add schema entry**

Modify `src/video/cli-schema.ts` by adding this command to `COMMANDS`:

```typescript
{
  name: 'studio',
  usage: 'vclaw studio --dry-run [--goal <goal>] [--project <slug>] [--title <title>] [--intent <text>] [--input <path-or-url>] [--client <name>] [--duration <seconds>] [--root <path>]',
  description: 'Generate a guided Studio production plan from high-level goals without running provider work.',
},
```

- [ ] **Step 3.4: Add CLI handler**

Modify `src/cli/vclaw.ts`:

```typescript
import { buildStudioPlan } from '../video/studio/planner.js';
import type { StudioGoal } from '../video/studio/types.js';
```

Add a handler near the other top-level handlers:

```typescript
function parseStudioGoal(value: string | undefined): StudioGoal | undefined {
  if (!value) return undefined;
  const allowed = new Set([
    'create-video',
    'copy-reference',
    'presenter-video',
    'music-video',
    'ugc-campaign',
    'existing-project',
    'review-regenerate',
    'publish-deliver',
  ]);
  if (!allowed.has(value)) {
    throw new VclawError('invalid_mode', `studio: unknown goal ${JSON.stringify(value)}`);
  }
  return value as StudioGoal;
}

async function handleStudio(args: string[]): Promise<void> {
  const durationRaw = parseFlagValue(args, '--duration');
  const durationSeconds = durationRaw ? Number.parseInt(durationRaw, 10) : undefined;
  if (durationRaw && (!Number.isInteger(durationSeconds) || durationSeconds <= 0)) {
    throw new VclawError('missing_required_flag', `studio: --duration must be a positive integer, got ${durationRaw}`);
  }

  const plan = buildStudioPlan({
    goal: parseStudioGoal(parseFlagValue(args, '--goal')),
    project: parseFlagValue(args, '--project') ?? undefined,
    title: parseFlagValue(args, '--title') ?? undefined,
    intent: parseFlagValue(args, '--intent') ?? undefined,
    input: parseFlagValue(args, '--input') ?? undefined,
    client: parseFlagValue(args, '--client') ?? undefined,
    ...(durationSeconds ? { durationSeconds } : {}),
    dryRun: true,
    root: parseFlagValue(args, '--root') ?? process.cwd(),
  });

  writeOutput(plan);
}
```

Wire dispatch so `vclaw studio ...` calls `handleStudio(args.slice(1))`.

- [ ] **Step 3.5: Run CLI tests**

Run:

```bash
npm run build && node --test dist/tests/cli-studio.test.js
```

Expected: pass.

### Task 4: Add Project-Aware Context For Existing Projects

**Files:**
- Create: `src/video/studio/project-context.ts`
- Modify: `src/video/studio/planner.ts`
- Modify: `src/cli/vclaw.ts`
- Modify: `src/tests/studio-planner.test.ts`
- Modify: `src/tests/cli-studio.test.ts`

- [ ] **Step 4.1: Add project-context helper**

Create `src/video/studio/project-context.ts`:

```typescript
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildProjectReadiness } from '../readiness.js';
import { buildNextActions } from '../next-actions.js';
import type { VideoProductionMode } from '../types.js';

export interface StudioProjectContext {
  projectExists: boolean;
  readinessReady?: boolean;
  readinessNextAction?: string;
  nextActionCount?: number;
}

export async function loadStudioProjectContext(
  root: string,
  project: string | undefined,
  mode: VideoProductionMode = 'storyboard',
): Promise<StudioProjectContext> {
  if (!project) return { projectExists: false };
  const projectDir = join(root, 'projects', project);
  if (!existsSync(projectDir)) return { projectExists: false };

  const readiness = await buildProjectReadiness(project, root, mode);
  const nextActions = await buildNextActions(root, mode);
  return {
    projectExists: true,
    readinessReady: readiness.ready,
    readinessNextAction: readiness.nextAction,
    nextActionCount: nextActions.actions.length,
  };
}
```

- [ ] **Step 4.2: Make planner accept optional context**

Change `StudioPlanInput` in `src/video/studio/types.ts`:

```typescript
export interface StudioPlanInput {
  goal?: StudioGoal;
  project?: string;
  title?: string;
  intent?: string;
  input?: string;
  client?: string;
  durationSeconds?: number;
  dryRun: boolean;
  root: string;
  projectContext?: {
    projectExists: boolean;
    readinessReady?: boolean;
    readinessNextAction?: string;
    nextActionCount?: number;
  };
}
```

In `buildStudioPlan`, add warnings:

```typescript
if (input.project && input.projectContext?.projectExists === false) {
  warnings.push(`Project ${input.project} does not exist yet; start with vclaw video init ${input.project}.`);
}
if (input.projectContext?.readinessNextAction) {
  warnings.push(`Project next action: ${input.projectContext.readinessNextAction}`);
}
```

- [ ] **Step 4.3: Load context in CLI before building plan**

Modify `handleStudio` in `src/cli/vclaw.ts`:

```typescript
import { loadStudioProjectContext } from '../video/studio/project-context.js';
```

Inside `handleStudio`:

```typescript
const root = parseFlagValue(args, '--root') ?? process.cwd();
const project = parseFlagValue(args, '--project') ?? undefined;
const projectContext = await loadStudioProjectContext(root, project);

const plan = buildStudioPlan({
  goal: parseStudioGoal(parseFlagValue(args, '--goal')),
  project,
  title: parseFlagValue(args, '--title') ?? undefined,
  intent: parseFlagValue(args, '--intent') ?? undefined,
  input: parseFlagValue(args, '--input') ?? undefined,
  client: parseFlagValue(args, '--client') ?? undefined,
  ...(durationSeconds ? { durationSeconds } : {}),
  dryRun: true,
  root,
  projectContext,
});
```

- [ ] **Step 4.4: Add an existing-project CLI fixture test**

In `src/tests/cli-studio.test.ts`, add a temp project test that runs:

```typescript
const init = spawnSync(process.execPath, [
  cliPath,
  'video',
  'init',
  'demo',
  '--root',
  root,
], { encoding: 'utf-8' });
assert.equal(init.status, 0, init.stderr);

const r = spawnSync(process.execPath, [
  cliPath,
  'studio',
  '--dry-run',
  '--goal',
  'existing-project',
  '--project',
  'demo',
  '--root',
  root,
], { encoding: 'utf-8' });
assert.equal(r.status, 0, r.stderr);
const payload = JSON.parse(r.stdout) as { warnings: string[]; steps: Array<{ command: string }> };
assert.ok(payload.steps.some((step) => step.command === 'vclaw video status --project demo'));
assert.ok(payload.warnings.some((warning) => warning.includes('Project next action')));
```

- [ ] **Step 4.5: Run focused tests**

Run:

```bash
npm run build && node --test dist/tests/studio-planner.test.js dist/tests/cli-studio.test.js
```

Expected: pass.

### Task 5: Persist Optional Studio Session Artifact

**Files:**
- Create: `src/video/studio/session.ts`
- Modify: `src/video/studio/types.ts`
- Modify: `src/cli/vclaw.ts`
- Create: `src/tests/studio-session.test.ts`

- [ ] **Step 5.1: Add session test**

Create `src/tests/studio-session.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStudioPlan } from '../video/studio/planner.js';
import { writeStudioSession } from '../video/studio/session.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

describe('studio session artifact', () => {
  it('writes studio-session.json into project artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-studio-session-'));
    await ensureProjectWorkspace(root, 'demo');
    const plan = buildStudioPlan({
      goal: 'presenter-video',
      project: 'demo',
      input: 'deck.pdf',
      client: 'Acme',
      dryRun: true,
      root,
    });

    const path = await writeStudioSession(root, 'demo', plan);
    assert.ok(path.endsWith('projects/demo/artifacts/studio-session.json'));
    const saved = JSON.parse(await readFile(path, 'utf-8')) as { plan: { goal: string } };
    assert.equal(saved.plan.goal, 'presenter-video');
  });
});
```

- [ ] **Step 5.2: Implement session writer**

Create `src/video/studio/session.ts`:

```typescript
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StudioPlan } from './types.js';

export interface StudioSessionArtifact {
  schemaVersion: 1;
  createdAt: string;
  plan: StudioPlan;
}

export async function writeStudioSession(root: string, project: string, plan: StudioPlan): Promise<string> {
  const artifactDir = join(root, 'projects', project, 'artifacts');
  await mkdir(artifactDir, { recursive: true });
  const path = join(artifactDir, 'studio-session.json');
  const artifact: StudioSessionArtifact = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    plan,
  };
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`);
  return path;
}
```

- [ ] **Step 5.3: Add `--write-session` CLI flag**

Modify `handleStudio` so:

```typescript
if (args.includes('--write-session')) {
  if (!project) {
    throw new VclawError('missing_required_flag', 'studio --write-session requires --project <slug>');
  }
  const artifactPath = await writeStudioSession(root, project, plan);
  writeOutput({ ...plan, artifactPath });
  return;
}
```

Import:

```typescript
import { writeStudioSession } from '../video/studio/session.js';
```

- [ ] **Step 5.4: Run tests**

Run:

```bash
npm run build && node --test dist/tests/studio-session.test.js dist/tests/cli-studio.test.js
```

Expected: pass.

### Task 6: Document Studio As The Human Front Door

**Files:**
- Create: `docs/STUDIO.md`
- Modify: `docs/CLI_REFERENCE.md`
- Modify: `docs/PRODUCTION_WORKFLOW.md`
- Modify: `skills/video-framework/SKILL.md`

- [ ] **Step 6.1: Add Studio docs**

Create `docs/STUDIO.md`:

```markdown
# Studio

`vclaw studio` is the human-friendly planning front door for VideoClaw.

It does not replace the low-level CLI. It builds a production plan from a goal,
then shows the exact commands and artifacts that will be used.

## Start With A Dry Run

```bash
vclaw studio --dry-run --goal create-video --project demo --intent "Create a 30 second product ad"
```

## Goals

| Goal | Use When |
|---|---|
| `create-video` | Original video from a brief |
| `copy-reference` | Adapt a reference video or ad |
| `presenter-video` | Bunty, Nex, Davendra, or generic presenter episode |
| `music-video` | Multi-shot cinematic or music video planning |
| `ugc-campaign` | Belief-driven UGC campaign |
| `existing-project` | Continue a project and get next actions |
| `review-regenerate` | Review, reroll, or approve scenes |
| `publish-deliver` | Build and publish a portal |

## Agent Contract

When stdout is piped, Studio outputs JSON. Progress and warnings stay out of
stdout. Provider execution is not performed by the dry-run planner.
```

- [ ] **Step 6.2: Add CLI reference entry**

In `docs/CLI_REFERENCE.md`, add a `vclaw studio` section with:

```markdown
## Studio Planner

```bash
vclaw studio --dry-run [--goal <goal>] [--project <slug>] [--intent <text>] [--input <path-or-url>] [--client <name>] [--duration <seconds>] [--write-session]
```

Use this when a human wants a guided production plan instead of choosing from
the full command catalog. The command is plan-only in Phase 1.
```

- [ ] **Step 6.3: Point production workflow at Studio**

In `docs/PRODUCTION_WORKFLOW.md`, add a short opening note:

```markdown
For human operators, start with `vclaw studio --dry-run`. It maps goals like
presenter video, UGC campaign, music video, copy-reference, review, and publish
to the deterministic CLI commands described below.
```

- [ ] **Step 6.4: Update skill front door guidance**

In `skills/video-framework/SKILL.md`, under the current product boundary, add:

```markdown
CLI planning surface: prefer `vclaw studio --dry-run` when the user wants an
interactive or guided menu-like experience. Studio should produce the command
plan; this skill remains the agent reasoning layer that interprets creative
intent.
```

- [ ] **Step 6.5: Run docs-sensitive checks**

Run:

```bash
npm run build
npm run check:skill-frontdoor
npm run check:cleanroom-docs
```

Expected: all pass.

### Task 7: Full Verification And Commit

**Files:**
- All files from Tasks 1-6.

- [ ] **Step 7.1: Run focused Studio tests**

Run:

```bash
npm run build && node --test dist/tests/studio-*.test.js dist/tests/cli-studio.test.js
```

Expected: all Studio tests pass.

- [ ] **Step 7.2: Run schema and release checks**

Run:

```bash
npm run check:artifact-schema-coverage
npm run check:release-readiness-lite
```

Expected: pass. If `studio-session.json` is intentionally not schema-covered in Phase 1, keep it as a session artifact under Studio docs and do not add it to typed artifact-store until a later schema task.

- [ ] **Step 7.3: Run full test suite**

Run:

```bash
npm test
```

Expected: full suite pass.

- [ ] **Step 7.4: Commit with Lore protocol**

Use a commit message shaped like:

```text
Make video production discoverable through a Studio planner

The existing CLI and skill inventory is powerful but difficult for humans to
enter because workflows are distributed across 77 commands and a large legacy
script tree. This adds a plan-only Studio front door that maps production goals
to deterministic command plans while preserving the JSON/non-TTY agent contract.

Constraint: Phase 1 adds no prompt/TUI dependency.
Rejected: Directly expose raw Python scripts in the menu | preserves legacy complexity instead of simplifying it.
Confidence: high
Scope-risk: moderate
Directive: Keep Studio planning pure and tested before adding interactive prompts or execution.
Tested: npm test
Not-tested: Real provider execution through Studio because Phase 1 is dry-run only.
Co-authored-by: OmX <omx@oh-my-codex.dev>
```

---

## Phase 2: Interactive Menu Layer

Phase 2 starts only after Phase 1 is merged and the dependency choice is approved.

### Task 8: Add Prompt Adapter Behind A Narrow Interface

**Files:**
- Modify: `package.json`
- Create: `src/video/studio/prompts.ts`
- Create: `src/tests/studio-prompts.test.ts`

- [ ] **Step 8.1: Add dependency only after approval**

Run:

```bash
npm install @inquirer/prompts
```

Expected: `package.json` and lockfile update. Do not do this before explicit dependency approval.

- [ ] **Step 8.2: Keep prompt UI isolated**

Create `src/video/studio/prompts.ts` with a narrow adapter that returns `StudioPlanInput`; do not import prompt code from `planner.ts`.

```typescript
import { input, select, confirm } from '@inquirer/prompts';
import type { StudioGoal, StudioPlanInput } from './types.js';

export async function promptForStudioPlan(root: string): Promise<StudioPlanInput> {
  const goal = await select<StudioGoal>({
    message: 'What are we making?',
    choices: [
      { name: 'Create new video', value: 'create-video' },
      { name: 'Copy/reference video', value: 'copy-reference' },
      { name: 'Presenter video', value: 'presenter-video' },
      { name: 'Music video / multi-shot', value: 'music-video' },
      { name: 'UGC campaign', value: 'ugc-campaign' },
      { name: 'Continue existing project', value: 'existing-project' },
      { name: 'Review or regenerate', value: 'review-regenerate' },
      { name: 'Publish or deliver', value: 'publish-deliver' },
    ],
  });

  const project = await input({ message: 'Project slug?' });
  const intent = await input({ message: 'Intent or brief?', required: false });
  const proceedDryRun = await confirm({ message: 'Build dry-run plan now?', default: true });

  return {
    goal,
    project,
    ...(intent ? { intent } : {}),
    dryRun: proceedDryRun,
    root,
  };
}
```

- [ ] **Step 8.3: Add `vclaw studio` TTY interactive mode**

In `handleStudio`, if `process.stdin.isTTY && process.stdout.isTTY && args.length === 0`, call `promptForStudioPlan(root)`. All non-TTY usage must continue to require explicit flags and return JSON.

### Task 9: Add Guided Feedback Loops

**Files:**
- Modify: `src/video/studio/types.ts`
- Modify: `src/video/studio/planner.ts`
- Modify: `docs/STUDIO.md`

- [ ] **Step 9.1: Add feedback actions to plan steps**

Extend `StudioPlanStep`:

```typescript
feedbackActions: Array<'approve' | 'regenerate' | 'edit-prompt' | 'switch-provider' | 'skip' | 'publish'>;
```

Map actions by recipe:

- Music video: `edit-prompt`, `regenerate`, `switch-provider`, `approve`
- Review/regenerate: `approve`, `regenerate`, `skip`
- Publish/deliver: `publish`, `skip`
- Presenter: `edit-prompt`, `regenerate`, `approve`, `publish`

- [ ] **Step 9.2: Document the loop**

Add to `docs/STUDIO.md`:

```markdown
After each generated plan step, Studio should ask for feedback using the
available actions on that step: approve, regenerate, edit prompt, switch
provider, skip, or publish. The action list is generated by the planner, not
hard-coded in the prompt UI.
```

---

## Risks And Mitigations

- **Risk:** Studio becomes a second orchestrator.
  **Mitigation:** Phase 1 emits command plans only; execution remains existing CLI commands.

- **Risk:** Interactive prompts break JSON stdout behavior.
  **Mitigation:** Prompt UI only runs when stdin/stdout are TTY and no explicit args are supplied.

- **Risk:** Raw Python scripts remain undiscoverable.
  **Mitigation:** Capture them as capability metadata later, but expose only stable `vclaw` recipes in Phase 1.

- **Risk:** Dependency churn.
  **Mitigation:** No new dependency in Phase 1; `@inquirer/prompts` is isolated behind `prompts.ts` in Phase 2.

- **Risk:** Project context reads become slow.
  **Mitigation:** Only load readiness/next-actions when `--project` is supplied; no provider calls.

## Verification Matrix

| Claim | Verification |
|---|---|
| Studio recipes are complete | `node --test dist/tests/studio-recipes.test.js` |
| Planner is deterministic | `node --test dist/tests/studio-planner.test.js` |
| CLI works in JSON mode | `node --test dist/tests/cli-studio.test.js` |
| Session artifact writes safely | `node --test dist/tests/studio-session.test.js` |
| Schema includes Studio | `vclaw schema --json` checked by `cli-studio.test.ts` |
| Existing release remains green | `npm test` |

## Execution Notes

- Implement Phase 1 before any prompt UI.
- Keep `buildStudioPlan` pure.
- Keep `project-context.ts` read-only.
- Use existing `writeOutput` for CLI output.
- Do not call providers from Studio in Phase 1.
- Do not add `@inquirer/prompts` until the dependency is explicitly approved.
