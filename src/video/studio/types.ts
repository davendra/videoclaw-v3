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

export type StudioExecutionPolicy = 'dry-run-first' | 'plan-first' | 'approval-gated';

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
  executionPolicy: StudioExecutionPolicy;
}

export interface StudioProjectContext {
  projectExists: boolean;
  readinessReady?: boolean;
  readinessNextAction?: string;
  nextActionCount?: number;
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
  projectContext?: StudioProjectContext;
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
