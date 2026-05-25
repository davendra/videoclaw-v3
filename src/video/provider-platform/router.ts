import {
  DEFAULT_PROVIDER_REGISTRY,
  DEFAULT_ROUTING_POLICY,
} from "./registry.js";
import type {
  ProviderHealthStatus,
  ProviderRouteId,
  ProviderRoutingPolicy,
  ProviderRoutingRequest,
  VideoProviderDescriptor,
  VideoProviderRouteDecision,
  VideoProviderRoutingResult,
} from "./types.js";

function getSupport(
  route: VideoProviderDescriptor,
  request: ProviderRoutingRequest
) {
  return route.operationSupport.find(
    (support) =>
      support.operation === request.operation &&
      support.aspectRatios.includes(request.aspectRatio)
  );
}

function costScore(route: VideoProviderDescriptor): number {
  switch (route.routingHints.costClass) {
    case "free":
      return 10;
    case "low":
      return 6;
    case "medium":
      return 3;
    case "high":
      return 0;
  }
}

function latencyScore(route: VideoProviderDescriptor): number {
  switch (route.routingHints.latencyClass) {
    case "low":
      return 8;
    case "medium":
      return 4;
    case "high":
      return 1;
  }
}

function providerOrderScore(
  routeId: ProviderRouteId,
  providerOrder: ProviderRouteId[]
): number {
  const index = providerOrder.indexOf(routeId);
  return index === -1 ? 0 : Math.max(providerOrder.length - index, 0);
}

function normalizeHealthStatus(
  routeId: ProviderRouteId,
  health: Partial<Record<ProviderRouteId, ProviderHealthStatus>>
): ProviderHealthStatus {
  return (
    health[routeId] ?? {
      state: "healthy",
      updatedAt: new Date(0).toISOString(),
    }
  );
}

function scoreRoute(
  route: VideoProviderDescriptor,
  request: ProviderRoutingRequest,
  policy: ProviderRoutingPolicy
): VideoProviderRouteDecision {
  const reasons: string[] = [];
  let score = providerOrderScore(route.id, policy.providerOrder);

  if (request.preferredProvider === route.provider) {
    score += 30;
    reasons.push(`preferred provider matched (${route.provider})`);
  }

  if (request.preferredPath === route.path) {
    score += 20;
    reasons.push(`preferred path matched (${route.path})`);
  }

  if (policy.preferDirectForTrust && route.path === "direct") {
    score += 15;
    reasons.push("policy prefers direct path when capabilities already match");
  }

  if (
    policy.preferUseApiWhenCapabilitiesUnlock &&
    route.id === "veo-useapi" &&
    request.aspectRatio === "portrait" &&
    (request.operation === "image-to-video" || request.operation === "frames-to-video")
  ) {
    score += 25;
    reasons.push("useapi unlocks portrait Veo coverage missing on the direct path");
  }

  if (route.routingHints.preferredWorkflows.includes(request.workflow)) {
    score += 12;
    reasons.push(`route is tuned for ${request.workflow}`);
  }

  if (request.preferLowCost) {
    score += costScore(route);
    reasons.push(`cost class ${route.routingHints.costClass}`);
  }

  if (request.preferLowLatency) {
    score += latencyScore(route);
    reasons.push(`latency class ${route.routingHints.latencyClass}`);
  }

  if (request.requiredControls && request.requiredControls.length > 0) {
    score += request.requiredControls.length * 5;
    reasons.push(
      `supports required controls: ${request.requiredControls.join(", ")}`
    );
  }

  if (route.path === "useapi" && request.providerOptions) {
    reasons.push("provider-specific options preserved via escape hatches");
  }

  if (reasons.length === 0) {
    reasons.push("route satisfied the normalized contract");
  }

  return {
    route,
    score,
    reasons,
    retainedEscapeHatches: route.escapeHatches,
  };
}

export function chooseVideoProviderRoute(
  request: ProviderRoutingRequest,
  options?: {
    registry?: VideoProviderDescriptor[];
    policy?: Partial<ProviderRoutingPolicy>;
    health?: Partial<Record<ProviderRouteId, ProviderHealthStatus>>;
  }
): VideoProviderRoutingResult {
  const registry = options?.registry ?? DEFAULT_PROVIDER_REGISTRY;
  const policy: ProviderRoutingPolicy = {
    ...DEFAULT_ROUTING_POLICY,
    ...options?.policy,
  };
  const health = options?.health ?? {};
  const filteredOut: VideoProviderRoutingResult["filteredOut"] = [];

  const candidates = registry.filter((route) => {
    if (request.allowProviders && !request.allowProviders.includes(route.id)) {
      filteredOut.push({ routeId: route.id, reason: "not in allowed provider set" });
      return false;
    }

    if (request.denyProviders?.includes(route.id)) {
      filteredOut.push({ routeId: route.id, reason: "explicitly denied" });
      return false;
    }

    const routeHealth = normalizeHealthStatus(route.id, health);
    if (routeHealth.state === "offline") {
      filteredOut.push({ routeId: route.id, reason: "provider health is offline" });
      return false;
    }
    if (routeHealth.state === "deprecated" && !policy.allowDeprecatedProviders) {
      filteredOut.push({ routeId: route.id, reason: "provider is deprecated" });
      return false;
    }
    if (routeHealth.state === "degraded" && !policy.allowDegradedProviders) {
      filteredOut.push({ routeId: route.id, reason: "provider is degraded" });
      return false;
    }

    const support = getSupport(route, request);
    if (!support) {
      filteredOut.push({
        routeId: route.id,
        reason: `${request.operation} ${request.aspectRatio} is unsupported`,
      });
      return false;
    }

    const missingControls = (request.requiredControls ?? []).filter(
      (control) => !route.controls.includes(control)
    );
    if (missingControls.length > 0) {
      filteredOut.push({
        routeId: route.id,
        reason: `missing required controls: ${missingControls.join(", ")}`,
      });
      return false;
    }

    return true;
  });

  if (candidates.length === 0) {
    const reasons = filteredOut.map(({ routeId, reason }) => `${routeId}: ${reason}`);
    throw new Error(
      `No provider route satisfies ${request.operation} (${request.aspectRatio}). ${reasons.join("; ")}`
    );
  }

  const decisions = candidates
    .map((route) => scoreRoute(route, request, policy))
    .sort((left, right) => right.score - left.score);

  return {
    primary: decisions[0]!,
    fallbacks: decisions.slice(1),
    filteredOut,
  };
}
