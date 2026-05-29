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
