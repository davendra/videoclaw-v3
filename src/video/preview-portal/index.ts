export {
  PREVIEW_PORTAL_STATUSES,
  PREVIEW_PORTAL_SURFACES,
  PREVIEW_PORTAL_TEMPLATES,
} from './types.js';

export { discoverPreviewPortalPortfolio, discoverPreviewPortalProject } from './discovery.js';
export { renderPreviewPortalHtml, renderPreviewPortalIndexHtml } from './render.js';
export { appendPreviewPortalAuditEvent, readPreviewPortalAuditEvents } from './audit.js';
export { generatePreviewPortalIndex, generatePreviewPortalSurfaces } from './generate.js';
export { buildPreviewPortalPublishPlan, publishPreviewPortal, publishPreviewPortalIndex } from './publish.js';
export { PREVIEW_PORTAL_TEMPLATE_REGISTRY, resolvePreviewPortalTemplate } from './templates.js';

export type {
  PreviewPortalAsset,
  PreviewPortalAuditEvent,
  PreviewPortalCard,
  PreviewPortalProject,
  PreviewPortalIndexRenderOptions,
  PreviewPortalRenderOptions,
  PreviewPortalRun,
  PreviewPortalStatus,
  PreviewPortalSurface,
  PreviewPortalTemplate,
  PreviewPortalTemplateId,
} from './types.js';
export type { DiscoverPreviewPortalPortfolioOptions, DiscoverPreviewPortalProjectOptions } from './discovery.js';
export type {
  GeneratePreviewPortalIndexOptions,
  GeneratePreviewPortalIndexResult,
  GeneratePreviewPortalSurfacesOptions,
  GeneratePreviewPortalSurfacesResult,
} from './generate.js';
export type {
  BuildPreviewPortalPublishPlanOptions,
  PreviewPortalPublishItem,
  PreviewPortalPublishPlan,
  PreviewPortalPublishResult,
  PublishPreviewPortalIndexOptions,
  PublishPreviewPortalOptions,
} from './publish.js';
