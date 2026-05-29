import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { VideoProjectWorkspace } from './workspace.js';

/**
 * A single product whose hero/variant images anchor the product-subject
 * filmmaking branch. `referenceAssets` are workspace-relative paths (the same
 * Asset:// mechanism used by character reference sheets).
 */
export interface ProductReference {
  name: string;
  referenceAssets: string[];
}

export interface ProductReferencesArtifact {
  schemaVersion: 1;
  products: ProductReference[];
}

/**
 * Read `artifacts/product-references.json` for a project. Returns an empty
 * product list when the file is absent — product-subject categories degrade
 * gracefully to description-only packets rather than failing.
 */
export async function readProductReferences(
  workspace: VideoProjectWorkspace,
): Promise<ProductReferencesArtifact> {
  const path = join(workspace.artifactsDir, 'product-references.json');
  if (!existsSync(path)) {
    return { schemaVersion: 1, products: [] };
  }
  const parsed = JSON.parse(await readFile(path, 'utf-8')) as Partial<ProductReferencesArtifact>;
  return {
    schemaVersion: 1,
    products: Array.isArray(parsed.products)
      ? parsed.products.map((product) => ({
          name: product.name,
          referenceAssets: Array.isArray(product.referenceAssets) ? product.referenceAssets : [],
        }))
      : [],
  };
}
