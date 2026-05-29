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

export const CATEGORY_IDS: string[] = Object.keys(CATEGORY_REGISTRY);

export function resolveCategory(id?: string): CategoryDescriptor {
  const key = id ?? 'cinematic';
  const descriptor = CATEGORY_REGISTRY[key];
  if (!descriptor) {
    throw new Error(`unknown category: ${id}`);
  }
  return descriptor;
}
