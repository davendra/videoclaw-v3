import { loadBenchmarkSuite, renderBenchmarkReport, scoreBenchmarkSuite } from "./benchmark";
import { createTelemetryRecord } from "../../../src/video/provider-platform/telemetry.ts";
import type { VideoRunTelemetryRecord } from "../../../src/video/provider-platform/types.ts";

function buildSmokeRecords(): VideoRunTelemetryRecord[] {
  return [
    createTelemetryRecord({
      runId: "smoke-ad-1",
      workflow: "ad-creative-variants",
      operation: "text-to-video",
      routeId: "veo-useapi",
      provider: "veo",
      path: "useapi",
      latencyMs: 82000,
      actualCostUsd: 0.12,
      retryCount: 1,
      outputDurationSeconds: 15,
      verdict: "accepted",
    }),
    createTelemetryRecord({
      runId: "smoke-demo-1",
      workflow: "product-demo-spokesperson",
      operation: "edit",
      routeId: "runway-useapi",
      provider: "runway",
      path: "useapi",
      latencyMs: 93000,
      actualCostUsd: 0.3,
      retryCount: 0,
      outputDurationSeconds: 30,
      verdict: "accepted",
    }),
  ];
}

const scenarios = loadBenchmarkSuite();
const report = scoreBenchmarkSuite(scenarios, buildSmokeRecords());

console.log(renderBenchmarkReport(report));
