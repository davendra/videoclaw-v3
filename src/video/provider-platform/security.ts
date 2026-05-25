import type { ProviderRouteId } from "./types.js";
import { DEFAULT_PROVIDER_REGISTRY } from "./registry.js";

/**
 * Validates that escape-hatch params are declared in the provider's
 * adapter definition. Rejects unknown params to prevent injection
 * of unsanctioned controls into UseAPI calls.
 */
export function validateEscapeHatches(
  routeId: ProviderRouteId,
  params: Record<string, unknown>,
): void {
  const route = DEFAULT_PROVIDER_REGISTRY.find((r) => r.id === routeId);
  if (!route) {
    throw new Error(`Unknown provider route: ${routeId}`);
  }

  const declaredNames = new Set(route.escapeHatches.map((h) => h.name));
  const paramKeys = Object.keys(params);

  for (const key of paramKeys) {
    if (!declaredNames.has(key)) {
      throw new Error(
        `Unknown escape hatch "${key}" for provider ${routeId}. ` +
          `Declared: [${[...declaredNames].join(", ")}]`,
      );
    }
  }
}
