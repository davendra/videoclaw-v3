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

function valueForPlaceholder(name: string, input: StudioPlanInput): string | undefined {
  switch (name) {
    case 'project':
      return input.project;
    case 'intent':
      return input.intent;
    case 'input':
      return input.input;
    case 'client':
      return input.client ?? 'client';
    case 'durationSeconds':
      return String(input.durationSeconds ?? 60);
    case 'template':
      return 'template';
    case 'bucket':
      return 'bucket';
    default:
      return undefined;
  }
}

function fillTemplate(template: string, input: StudioPlanInput): string {
  return template.replaceAll(/<([A-Za-z0-9]+)>/g, (match, rawName: string) => {
    const value = valueForPlaceholder(rawName, input);
    return value ? shellQuote(value) : match;
  });
}

function commandWithRoot(command: string, input: StudioPlanInput): string {
  if (input.root === process.cwd()) return command;
  if (!command.startsWith('vclaw video ')) return command;
  if (command.includes(' --root ')) return command;
  return `${command} --root ${shellQuote(input.root)}`;
}

function requiredInputMissing(name: string, input: StudioPlanInput): boolean {
  switch (name) {
    case 'project':
      return !input.project;
    case 'intent':
      return !input.intent;
    case 'input':
      return !input.input;
    case 'client':
      return !input.client;
    default:
      return false;
  }
}

export function buildStudioPlan(input: StudioPlanInput): StudioPlan {
  const goal = resolveGoal(input);
  const recipe = STUDIO_RECIPES.find((item) => item.id === goal);
  if (!recipe) {
    throw new Error(`Unknown studio goal: ${goal}`);
  }

  const missingInputs = recipe.requiredInputs.filter((name) => requiredInputMissing(name, input));
  const warnings: string[] = [];
  if (recipe.riskLevel === 'high') {
    warnings.push('This recipe can lead to provider credits being spent after approval; keep dry-run until assets and prompts are reviewed.');
  }
  if (!input.dryRun) {
    warnings.push('Phase 1 studio planner is plan-only; execution is intentionally not enabled yet.');
  }
  if (input.project && input.projectContext?.projectExists === false) {
    warnings.push(`Project ${input.project} does not exist yet; start with vclaw video init ${input.project}.`);
  }
  if (input.projectContext?.readinessNextAction) {
    warnings.push(`Project next action: ${input.projectContext.readinessNextAction}`);
  }
  if (input.projectContext?.nextActionCount !== undefined) {
    warnings.push(`Portfolio next-action count: ${input.projectContext.nextActionCount}.`);
  }

  const steps: StudioPlanStep[] = missingInputs.length > 0
    ? []
    : recipe.commands.map((command) => ({
        id: command.id,
        title: command.title,
        command: commandWithRoot(fillTemplate(command.primary, input), input),
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
