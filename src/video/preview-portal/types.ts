export const PREVIEW_PORTAL_SURFACES = [
  'edit',
  'review',
  'client-review',
  'preview',
  'compare',
  'index',
] as const;

export const PREVIEW_PORTAL_STATUSES = [
  'draft',
  'editor-review',
  'changes-requested',
  'client-review',
  'client-declined',
  'client-approved',
  'final',
  'published',
  'archived',
] as const;

export const PREVIEW_PORTAL_TEMPLATES = [
  'music-video',
  'story-film',
  'documentary',
  'product-ad',
  'sports-recap',
  'generic-video',
] as const;

export type PreviewPortalSurface = typeof PREVIEW_PORTAL_SURFACES[number];
export type PreviewPortalStatus = typeof PREVIEW_PORTAL_STATUSES[number];
export type PreviewPortalTemplateId = typeof PREVIEW_PORTAL_TEMPLATES[number];

export interface PreviewPortalTemplate {
  id: PreviewPortalTemplateId;
  name: string;
  heroLabel: string;
  primaryAssetLabel: string;
  sectionOrder: string[];
  sectionLabels: Record<string, string>;
}

export interface PreviewPortalAsset {
  id: string;
  path: string;
  kind: 'image' | 'video' | 'audio' | 'html' | 'json' | 'text' | 'other';
  label: string;
  section: string;
  sizeBytes?: number;
  exists: boolean;
}

export interface PreviewPortalCard {
  id: string;
  kind: 'character' | 'scene' | 'clip' | 'final' | 'version' | 'asset' | 'run';
  title: string;
  subtitle?: string;
  assetIds: string[];
  reviewable: boolean;
}

export interface PreviewPortalRun {
  runId: string;
  label: string;
  status: PreviewPortalStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
  approvedAt?: string | null;
  declinedAt?: string | null;
}

export interface PreviewPortalProject {
  client?: string | null;
  slug: string;
  title: string;
  template: PreviewPortalTemplateId;
  status: PreviewPortalStatus;
  projectDir: string;
  run: PreviewPortalRun;
  summary?: string;
  assets: PreviewPortalAsset[];
  cards: PreviewPortalCard[];
  /**
   * Optional project soundtrack/score. When present, the polished `preview`
   * showcase renders an `<audio controls preload="none">` player; when absent,
   * no audio element is emitted. Discovered from an audio asset (.mp3/.m4a/.wav)
   * or a `soundtrack`/`audio` manifest field.
   */
  soundtrack?: PreviewPortalSoundtrack;
}

export interface PreviewPortalSoundtrack {
  /** Project-relative path to the audio file. */
  path: string;
  /** Human-readable label for the track. */
  label: string;
}

export interface PreviewPortalRenderOptions {
  surface: PreviewPortalSurface;
  project: PreviewPortalProject;
  compareProjects?: PreviewPortalProject[];
}

export interface PreviewPortalIndexRenderOptions {
  projects: PreviewPortalProject[];
  client?: string | null;
  title?: string;
  generatedAt?: string;
  linkPrefix?: string;
  linkMode?: 'local' | 'published-run';
}

export interface PreviewPortalAuditEvent {
  timestamp: string;
  event:
    | 'surface.generated'
    | 'surface.published'
    | 'client.feedback.copied'
    | 'editor.review.copied'
    | 'run.created'
    | 'run.promoted';
  client?: string | null;
  project: string;
  run: string;
  surface?: PreviewPortalSurface;
  template?: PreviewPortalTemplateId;
  output?: string;
  assetCount?: number;
  url?: string;
  htmlHash?: string;
  status?: PreviewPortalStatus;
}
