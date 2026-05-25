import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  chooseVideoProviderRoute,
  loadBenchmarkSuite,
  scoreBenchmarkSuite,
  appendTelemetryRecord,
  createTelemetryRecord,
  readTelemetryRecords,
  summarizeTelemetry,
} from "../src/provider-platform";

describe("provider platform router", () => {
  test("prefers direct Veo when trust-first policy is satisfied", () => {
    const route = chooseVideoProviderRoute({
      operation: "text-to-video",
      aspectRatio: "landscape",
      workflow: "generic",
      preferredProvider: "veo",
    });

    expect(route.primary.route.id).toBe("veo-direct");
    expect(route.fallbacks[0]?.route.id).toBe("veo-useapi");
  });

  test("prefers useapi Veo when portrait image-to-video is required", () => {
    const route = chooseVideoProviderRoute({
      operation: "image-to-video",
      aspectRatio: "portrait",
      workflow: "ad-creative-variants",
      preferredProvider: "veo",
    });

    expect(route.primary.route.id).toBe("veo-useapi");
    expect(route.filteredOut).toContainEqual({
      routeId: "veo-direct",
      reason: "image-to-video portrait is unsupported",
    });
  });

  test("keeps Runway escape hatches when edit-native controls are requested", () => {
    const route = chooseVideoProviderRoute({
      operation: "edit",
      aspectRatio: "landscape",
      workflow: "product-demo-spokesperson",
      preferredProvider: "runway",
      requiredControls: ["native-edit", "lip-sync", "audio"],
      providerOptions: {
        lipSyncProfile: "product-demo",
      },
    });

    expect(route.primary.route.id).toBe("runway-useapi");
    expect(route.primary.retainedEscapeHatches[0]?.name).toBe("runwayOptions");
  });
});

describe("provider platform telemetry + benchmark harness", () => {
  test("persists telemetry records to jsonl and summarizes them", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "videoclaw-provider-platform-"));
    const logPath = join(tempDir, "telemetry", "video-runs.jsonl");

    appendTelemetryRecord(
      logPath,
      createTelemetryRecord({
        runId: "run-1",
        workflow: "ad-creative-variants",
        operation: "text-to-video",
        routeId: "veo-useapi",
        provider: "veo",
        path: "useapi",
        latencyMs: 90000,
        actualCostUsd: 0.15,
        retryCount: 1,
        outputDurationSeconds: 15,
        verdict: "accepted",
      })
    );
    appendTelemetryRecord(
      logPath,
      createTelemetryRecord({
        runId: "run-2",
        workflow: "product-demo-spokesperson",
        operation: "edit",
        routeId: "runway-useapi",
        provider: "runway",
        path: "useapi",
        latencyMs: 100000,
        actualCostUsd: 0.32,
        retryCount: 0,
        outputDurationSeconds: 30,
        verdict: "needs-edit",
      })
    );

    const records = readTelemetryRecords(logPath);
    const summary = summarizeTelemetry(records);

    expect(records).toHaveLength(2);
    expect(summary.totalRuns).toBe(2);
    expect(summary.acceptedRuns).toBe(1);

    rmSync(tempDir, { recursive: true, force: true });
  });

  test("scores bundled phase0 benchmark workflows", () => {
    const scenarios = loadBenchmarkSuite(join(process.cwd(), "benchmarks/workflows.phase0.json"));
    const report = scoreBenchmarkSuite(scenarios, [
      createTelemetryRecord({
        runId: "baseline-ad-1",
        workflow: "ad-creative-variants",
        operation: "text-to-video",
        routeId: "veo-useapi",
        provider: "veo",
        path: "useapi",
        latencyMs: 85000,
        actualCostUsd: 0.2,
        retryCount: 1,
        outputDurationSeconds: 15,
        verdict: "accepted",
      }),
      createTelemetryRecord({
        runId: "baseline-ad-2",
        workflow: "ad-creative-variants",
        operation: "image-to-video",
        routeId: "kling-useapi",
        provider: "kling",
        path: "useapi",
        latencyMs: 92000,
        actualCostUsd: 0.18,
        retryCount: 1,
        outputDurationSeconds: 15,
        verdict: "accepted",
      }),
      createTelemetryRecord({
        runId: "baseline-demo-1",
        workflow: "product-demo-spokesperson",
        operation: "edit",
        routeId: "runway-useapi",
        provider: "runway",
        path: "useapi",
        latencyMs: 110000,
        actualCostUsd: 0.4,
        retryCount: 0,
        outputDurationSeconds: 30,
        verdict: "accepted",
      }),
      createTelemetryRecord({
        runId: "baseline-demo-2",
        workflow: "product-demo-spokesperson",
        operation: "add-audio",
        routeId: "runway-useapi",
        provider: "runway",
        path: "useapi",
        latencyMs: 120000,
        actualCostUsd: 0.35,
        retryCount: 1,
        outputDurationSeconds: 30,
        verdict: "accepted",
      }),
    ]);

    expect(report.scenarioCount).toBe(2);
    expect(report.scores).toHaveLength(2);
    expect(report.scores.every((score) => score.pass)).toBe(true);
  });
});
