import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { artifactPathFor } from './artifact-store.js';
import { resolveProjectWorkspace } from './workspace.js';
import type { StoryboardArtifact } from './artifacts.js';
import type { VideoAnalyzeOutput } from './types.js';

export interface VideoTemplate {
  name: string;
  sourceProject: string;
  createdAt: string;
  updatedAt: string;
  summary: string;
  pacing: VideoAnalyzeOutput['pacing'];
  structure: VideoAnalyzeOutput['structure'];
  motionClassification: VideoAnalyzeOutput['motionClassification'];
  keep: string[];
  change: string[];
  reusableVariables: string[];
  styleLayers?: string[];
  beatCompression?: VideoAnalyzeOutput['beatCompression'];
  technicalNotes?: string[];
  dialogueNotes?: string[];
  workflowChecklist?: string[];
}

export interface ClonePlan {
  templateName: string;
  projectSlug: string;
  intent: string;
  recommendedPacing: VideoAnalyzeOutput['pacing']['label'];
  recommendedMotionMode: VideoAnalyzeOutput['motionClassification']['primaryMode'];
  keepFromReference: string[];
  adaptForIntent: string[];
  reusableVariables: string[];
  beats: string[];
  styleLayers?: string[];
  beatCompression?: VideoAnalyzeOutput['beatCompression'];
  technicalNotes?: string[];
  dialogueNotes?: string[];
  workflowChecklist?: string[];
  generatedAt: string;
}

export interface TemplateValidationIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface TemplateValidationResult {
  templateName: string;
  valid: boolean;
  issues: TemplateValidationIssue[];
}

export function buildStoryboardFromClonePlan(
  clonePlan: ClonePlan,
  productionMode: 'storyboard' | 'director' = 'storyboard',
): StoryboardArtifact {
  return {
    projectSlug: clonePlan.projectSlug,
    productionMode,
    scenes: clonePlan.beats.map((beat, sceneIndex) => ({
      sceneIndex,
      description: `${beat}: adapt this beat for "${clonePlan.intent}" while keeping ${clonePlan.keepFromReference.join(', ') || 'the reference energy'}.`,
    })),
  };
}

function defaultStyleLayers(analyze: VideoAnalyzeOutput): string[] {
  return [
    `pacing:${analyze.pacing.label}`,
    `motion:${analyze.motionClassification.primaryMode}`,
    ...(analyze.structure.hook ? ['hook-first'] : []),
  ];
}

function defaultBeatCompression(analyze: VideoAnalyzeOutput): NonNullable<VideoAnalyzeOutput['beatCompression']> {
  const targetDurationSeconds = Math.min(Math.max(analyze.reference.durationSeconds ?? 15, 6), 30);
  return {
    targetDurationSeconds,
    maxBeats: Math.min(Math.max(analyze.structure.beats.length, 3), 6),
    dialogueWordBudget: Math.floor(targetDurationSeconds * 2.5),
    notes: ['Keep each beat short enough to fit a compact social clip.'],
  };
}

function defaultWorkflowChecklist(template: Pick<VideoTemplate, 'keep' | 'change' | 'reusableVariables'>): string[] {
  return [
    'Preserve the reusable hook and beat order, not brand-specific wording.',
    'Replace product, audience, proof, and offer variables for the new intent.',
    template.keep.length > 0
      ? `Keep reference traits: ${template.keep.join(', ')}.`
      : 'Keep only the reference pacing and structural energy.',
    template.change.length > 0
      ? `Change for new intent: ${template.change.join(', ')}.`
      : 'Change all claims, names, and brand-specific details.',
    template.reusableVariables.length > 0
      ? `Fill variables: ${template.reusableVariables.join(', ')}.`
      : 'Define product, audience, offer, proof, objection, and CTA variables.',
  ];
}

function templatesDir(root: string): string {
  return join(resolve(root), 'templates', 'video');
}

function templatePath(root: string, name: string): string {
  return join(templatesDir(root), `${name}.json`);
}

export async function saveTemplateFromAnalyzeOutput(input: {
  root?: string;
  projectSlug: string;
  templateName: string;
}): Promise<{ outputPath: string; template: VideoTemplate }> {
  const root = input.root ?? process.cwd();
  const workspace = resolveProjectWorkspace(input.projectSlug, root);
  const analyzePath = artifactPathFor(workspace, 'analyze-output');
  if (!existsSync(analyzePath)) {
    throw new Error(`Analyze artifact not found for project "${input.projectSlug}".`);
  }

  const analyze = JSON.parse(await readFile(analyzePath, 'utf-8')) as VideoAnalyzeOutput;
  const now = new Date().toISOString();
  const template: VideoTemplate = {
    name: input.templateName,
    sourceProject: input.projectSlug,
    createdAt: now,
    updatedAt: now,
    summary: analyze.reference.title ?? analyze.reference.source,
    pacing: analyze.pacing,
    structure: analyze.structure,
    motionClassification: analyze.motionClassification,
    keep: analyze.keep,
    change: analyze.change,
    reusableVariables: analyze.reusableVariables,
    styleLayers: analyze.styleLayers ?? defaultStyleLayers(analyze),
    beatCompression: analyze.beatCompression ?? defaultBeatCompression(analyze),
    technicalNotes: analyze.technicalNotes ?? [],
    dialogueNotes: analyze.dialogueNotes ?? [],
  };
  template.workflowChecklist = defaultWorkflowChecklist(template);

  const dir = templatesDir(root);
  await mkdir(dir, { recursive: true });
  const outputPath = templatePath(root, input.templateName);
  await writeFile(outputPath, `${JSON.stringify(template, null, 2)}\n`);
  return { outputPath, template };
}

export async function listTemplates(root = process.cwd()): Promise<string[]> {
  const dir = templatesDir(root);
  if (!existsSync(dir)) return [];
  return (await readdir(dir))
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => entry.replace(/\.json$/, ''))
    .sort();
}

export async function readTemplate(
  name: string,
  root = process.cwd(),
): Promise<VideoTemplate | null> {
  const path = templatePath(root, name);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf-8')) as VideoTemplate;
}

export async function validateTemplate(
  name: string,
  root = process.cwd(),
): Promise<TemplateValidationResult> {
  const template = await readTemplate(name, root);
  if (!template) {
    throw new Error(`Template "${name}" not found.`);
  }

  const issues: TemplateValidationIssue[] = [];
  if (!template.name.trim()) issues.push({ severity: 'error', message: 'Template missing name.' });
  if (!template.sourceProject.trim()) issues.push({ severity: 'error', message: 'Template missing sourceProject.' });
  if (!template.summary.trim()) issues.push({ severity: 'error', message: 'Template missing summary.' });
  if (!['slow', 'medium', 'fast', 'mixed'].includes(template.pacing.label)) {
    issues.push({ severity: 'error', message: 'Template has invalid pacing label.' });
  }
  if (!['motion-clips', 'animated-stills', 'mixed', 'unknown'].includes(template.motionClassification.primaryMode)) {
    issues.push({ severity: 'error', message: 'Template has invalid motion classification.' });
  }
  if (!Array.isArray(template.structure.beats) || template.structure.beats.length === 0 || template.structure.beats.some((beat) => beat.trim() === '')) {
    issues.push({ severity: 'error', message: 'Template must contain at least one non-empty beat.' });
  }
  if (!Array.isArray(template.keep)) issues.push({ severity: 'error', message: 'Template keep field must be an array.' });
  if (!Array.isArray(template.change)) issues.push({ severity: 'error', message: 'Template change field must be an array.' });
  if (!Array.isArray(template.reusableVariables)) issues.push({ severity: 'error', message: 'Template reusableVariables field must be an array.' });
  if (template.styleLayers !== undefined && !Array.isArray(template.styleLayers)) {
    issues.push({ severity: 'error', message: 'Template styleLayers field must be an array when present.' });
  }
  if (template.workflowChecklist !== undefined && !Array.isArray(template.workflowChecklist)) {
    issues.push({ severity: 'error', message: 'Template workflowChecklist field must be an array when present.' });
  }
  if (!template.createdAt.trim()) issues.push({ severity: 'error', message: 'Template missing createdAt.' });
  if (!template.updatedAt.trim()) issues.push({ severity: 'error', message: 'Template missing updatedAt.' });

  return {
    templateName: template.name,
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
  };
}

export async function buildClonePlan(input: {
  root?: string;
  templateName: string;
  projectSlug: string;
  intent: string;
}): Promise<ClonePlan> {
  const root = input.root ?? process.cwd();
  const template = await readTemplate(input.templateName, root);
  if (!template) {
    throw new Error(`Template "${input.templateName}" not found.`);
  }

  return {
    templateName: template.name,
    projectSlug: input.projectSlug,
    intent: input.intent,
    recommendedPacing: template.pacing.label,
    recommendedMotionMode: template.motionClassification.primaryMode,
    keepFromReference: template.keep,
    adaptForIntent: template.change,
    reusableVariables: template.reusableVariables,
    beats: template.structure.beats,
    ...(template.styleLayers ? { styleLayers: template.styleLayers } : {}),
    ...(template.beatCompression ? { beatCompression: template.beatCompression } : {}),
    ...(template.technicalNotes ? { technicalNotes: template.technicalNotes } : {}),
    ...(template.dialogueNotes ? { dialogueNotes: template.dialogueNotes } : {}),
    workflowChecklist: template.workflowChecklist ?? defaultWorkflowChecklist(template),
    generatedAt: new Date().toISOString(),
  };
}
