import type { PreviewPortalTemplate, PreviewPortalTemplateId } from './types.js';

const BASE_SECTION_LABELS: Record<string, string> = {
  final: 'Finals',
  videos: 'Scene Clips',
  images: 'Images',
  'generation-inputs': 'Generation Inputs',
  characters: 'Characters',
  audio: 'Audio',
  prompts: 'Prompts',
  'prompt-packets': 'Prompt Packets',
  variants: 'Versions',
};

export const PREVIEW_PORTAL_TEMPLATE_REGISTRY: Record<PreviewPortalTemplateId, PreviewPortalTemplate> = {
  'music-video': {
    id: 'music-video',
    name: 'Music Video',
    heroLabel: 'music video review',
    primaryAssetLabel: 'Current music video',
    sectionOrder: ['final', 'videos', 'images', 'generation-inputs', 'prompt-packets', 'characters', 'audio', 'prompts', 'variants'],
    sectionLabels: {
      ...BASE_SECTION_LABELS,
      videos: 'Performance Clips',
      images: 'Key Frames',
      'generation-inputs': 'Seedance Input Frames',
      'prompt-packets': 'Seedance Prompt Packets',
      audio: 'Track & Mixes',
    },
  },
  'story-film': {
    id: 'story-film',
    name: 'Story Film',
    heroLabel: 'story review',
    primaryAssetLabel: 'Current cut',
    sectionOrder: ['final', 'videos', 'images', 'generation-inputs', 'prompt-packets', 'characters', 'prompts', 'audio', 'variants'],
    sectionLabels: {
      ...BASE_SECTION_LABELS,
      videos: 'Scenes',
      images: 'Stills',
      'generation-inputs': 'Video Generation Inputs',
      'prompt-packets': 'Filmmaking Prompt Packets',
      prompts: 'Scene Prompts',
    },
  },
  documentary: {
    id: 'documentary',
    name: 'Documentary',
    heroLabel: 'documentary review',
    primaryAssetLabel: 'Current documentary cut',
    sectionOrder: ['final', 'videos', 'audio', 'images', 'generation-inputs', 'prompt-packets', 'prompts', 'variants', 'characters'],
    sectionLabels: {
      ...BASE_SECTION_LABELS,
      videos: 'Interview & B-roll Clips',
      images: 'Reference Stills',
      'generation-inputs': 'Verified Source Frames',
      'prompt-packets': 'Interview & Motion Prompt Packets',
      audio: 'Narration & Sync Audio',
      prompts: 'Research & Prompts',
    },
  },
  'product-ad': {
    id: 'product-ad',
    name: 'Product Ad',
    heroLabel: 'ad review',
    primaryAssetLabel: 'Current ad cut',
    sectionOrder: ['final', 'variants', 'videos', 'images', 'generation-inputs', 'prompt-packets', 'prompts', 'audio', 'characters'],
    sectionLabels: {
      ...BASE_SECTION_LABELS,
      final: 'Final Ads',
      variants: 'Aspect Variants',
      videos: 'Product Shots',
      images: 'Product Frames',
      'generation-inputs': 'Ad Generation Inputs',
      'prompt-packets': 'Ad Prompt Packets',
    },
  },
  'sports-recap': {
    id: 'sports-recap',
    name: 'Sports Recap',
    heroLabel: 'sports recap review',
    primaryAssetLabel: 'Current recap',
    sectionOrder: ['final', 'videos', 'images', 'generation-inputs', 'prompt-packets', 'audio', 'prompts', 'variants', 'characters'],
    sectionLabels: {
      ...BASE_SECTION_LABELS,
      videos: 'Highlights',
      images: 'Hero Frames',
      'generation-inputs': 'Clip Source Frames',
      'prompt-packets': 'Recap Prompt Packets',
      audio: 'Commentary & Music',
    },
  },
  'generic-video': {
    id: 'generic-video',
    name: 'Generic Video',
    heroLabel: 'video review',
    primaryAssetLabel: 'Current final',
    sectionOrder: ['final', 'videos', 'images', 'generation-inputs', 'prompt-packets', 'characters', 'audio', 'prompts', 'variants'],
    sectionLabels: BASE_SECTION_LABELS,
  },
};

export function resolvePreviewPortalTemplate(id: PreviewPortalTemplateId): PreviewPortalTemplate {
  return PREVIEW_PORTAL_TEMPLATE_REGISTRY[id] ?? PREVIEW_PORTAL_TEMPLATE_REGISTRY['generic-video'];
}
