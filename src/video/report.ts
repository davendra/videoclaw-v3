import { buildPortfolioMetrics } from './metrics.js';
import { buildProjectIndex } from './project-index.js';
import { doctorPortfolio } from './doctor-portfolio.js';
import { buildTimeline } from './timeline.js';
import type { VideoProductionMode } from './types.js';

export interface VideoPortfolioReport {
  generatedAt: string;
  root: string;
  metrics: Awaited<ReturnType<typeof buildPortfolioMetrics>>;
  health: Awaited<ReturnType<typeof doctorPortfolio>>;
  index: Awaited<ReturnType<typeof buildProjectIndex>>;
  timeline: Awaited<ReturnType<typeof buildTimeline>>;
}

export async function buildPortfolioReport(
  root = process.cwd(),
  productionMode: VideoProductionMode = 'storyboard',
): Promise<VideoPortfolioReport> {
  const [metrics, health, index, timeline] = await Promise.all([
    buildPortfolioMetrics(root, productionMode),
    doctorPortfolio(root, productionMode),
    buildProjectIndex(root, productionMode),
    buildTimeline(root),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    root,
    metrics,
    health,
    index,
    timeline,
  };
}
