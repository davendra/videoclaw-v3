export type SubjectType = 'character' | 'product';

export type BeatTemplate = 'three-act' | 'ad-hook-feature-cta' | 'turntable' | 'lookbook';

export interface CategoryDescriptor {
  id: string;
  label: string;
  subjectType: SubjectType;
  beatTemplate: BeatTemplate;
  cameraVocab: string;
  genre: string;
  audioProfile: 'diegetic' | 'ad-mix';
  hookSeconds: number;
}

const CATEGORY_REGISTRY: Record<string, CategoryDescriptor> = {
  cinematic: {
    id: 'cinematic',
    label: 'Cinematic / Narrative',
    subjectType: 'character',
    beatTemplate: 'three-act',
    cameraVocab: 'cinematic',
    genre: 'live-action',
    audioProfile: 'diegetic',
    hookSeconds: 0,
  },
  'ecommerce-ad': {
    id: 'ecommerce-ad',
    label: 'E-commerce Ad',
    subjectType: 'product',
    beatTemplate: 'ad-hook-feature-cta',
    cameraVocab: 'cinematic',
    genre: 'live-action',
    audioProfile: 'ad-mix',
    hookSeconds: 2,
  },
  'brand-story': {
    id: 'brand-story',
    label: 'Brand Story',
    subjectType: 'character',
    beatTemplate: 'ad-hook-feature-cta',
    cameraVocab: 'cinematic',
    genre: 'live-action',
    audioProfile: 'ad-mix',
    hookSeconds: 2,
  },
  'product-360': {
    id: 'product-360',
    label: 'Product 360 / Turntable',
    subjectType: 'product',
    beatTemplate: 'turntable',
    cameraVocab: 'orbit',
    genre: 'live-action',
    audioProfile: 'ad-mix',
    hookSeconds: 0,
  },
  'fashion-lookbook': {
    id: 'fashion-lookbook',
    label: 'Fashion Lookbook',
    subjectType: 'product',
    beatTemplate: 'lookbook',
    cameraVocab: 'cinematic',
    genre: 'live-action',
    audioProfile: 'ad-mix',
    hookSeconds: 2,
  },
  'food-beverage': {
    id: 'food-beverage',
    label: 'Food & Beverage',
    subjectType: 'product',
    beatTemplate: 'ad-hook-feature-cta',
    cameraVocab: 'macro',
    genre: 'live-action',
    audioProfile: 'ad-mix',
    hookSeconds: 2,
  },
  'real-estate': {
    id: 'real-estate',
    label: 'Real Estate',
    subjectType: 'product',
    beatTemplate: 'ad-hook-feature-cta',
    cameraVocab: 'glide',
    genre: 'live-action',
    audioProfile: 'ad-mix',
    hookSeconds: 2,
  },
  'motion-design-ad': {
    id: 'motion-design-ad',
    label: 'Motion Design Ad',
    subjectType: 'product',
    beatTemplate: 'ad-hook-feature-cta',
    cameraVocab: 'stylized',
    genre: 'pixar',
    audioProfile: 'ad-mix',
    hookSeconds: 2,
  },
  'comic-to-video': {
    id: 'comic-to-video',
    label: 'Comic to Video',
    subjectType: 'character',
    beatTemplate: 'ad-hook-feature-cta',
    cameraVocab: 'stylized',
    genre: 'anime',
    audioProfile: 'ad-mix',
    hookSeconds: 2,
  },
};

export type ReferenceBuildStep = 'base-ref' | 'sheet' | 'scene-plate';

/**
 * Canonical identity-reference build order (the banana-pro-director discipline).
 *
 * Always build identity references in this sequence, for both character and
 * product subjects:
 *   1. `base-ref`     — a neutral white-seamless base reference establishing the
 *                       subject's canonical identity, free of scene context.
 *   2. `sheet`        — a multi-angle reference sheet derived from the base ref.
 *   3. `scene-plate`  — scene plates that place the established subject in context.
 *
 * Building out of order (e.g. a scene plate before a clean base ref) lets scene
 * lighting and framing contaminate the identity anchor, so the order is fixed.
 */
export function referenceBuildOrder(_subjectType: SubjectType): ReferenceBuildStep[] {
  return ['base-ref', 'sheet', 'scene-plate'];
}

export const CATEGORY_IDS: string[] = Object.keys(CATEGORY_REGISTRY);

export function resolveCategory(id?: string): CategoryDescriptor {
  const key = id ?? 'cinematic';
  const descriptor = CATEGORY_REGISTRY[key];
  if (!descriptor) {
    throw new Error(`unknown category: ${id}`);
  }
  return descriptor;
}
