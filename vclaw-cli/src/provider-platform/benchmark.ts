import { readFileSync } from "fs";
import { resolve } from "path";
import type {
  BenchmarkReport,
  BenchmarkScenario,
  BenchmarkWorkflowScore,
  VideoRunTelemetryRecord,
  VideoWorkflowKind,
} from "../../../src/video/provider-platform/types.ts";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
  }
  return sorted[midpoint]!;
}

export function loadBenchmarkSuite(filePath?: string): BenchmarkScenario[] {
  const benchmarkPath =
    filePath ?? resolve(process.cwd(), "benchmarks/workflows.phase0.json");
  return JSON.parse(readFileSync(benchmarkPath, "utf8")) as BenchmarkScenario[];
}

function scoreWorkflow(
  workflow: VideoWorkflowKind,
  scenarios: BenchmarkScenario[],
  records: VideoRunTelemetryRecord[]
): BenchmarkWorkflowScore {
  const approvalCount = records.filter((record) => record.verdict === "accepted").length;
  const approvedRecords = records.filter((record) => record.verdict === "accepted");
  const totalApprovedMinutes = approvedRecords.reduce(
    (sum, record) => sum + (record.outputDurationSeconds ?? 0) / 60,
    0
  );
  const totalCost = records.reduce(
    (sum, record) => sum + (record.actualCostUsd ?? record.estimatedCostUsd ?? 0),
    0
  );
  const scenarioBudgets = scenarios.map((scenario) => scenario.metricBudgets);
  const strictestBudget = {
    minimumApprovalRate: Math.max(...scenarioBudgets.map((budget) => budget.minimumApprovalRate)),
    maximumMedianLatencyMs: Math.min(...scenarioBudgets.map((budget) => budget.maximumMedianLatencyMs)),
    maximumCostPerApprovedMinuteUsd: Math.min(
      ...scenarioBudgets.map((budget) => budget.maximumCostPerApprovedMinuteUsd)
    ),
    maximumRetryRate: Math.min(...scenarioBudgets.map((budget) => budget.maximumRetryRate)),
  };

  const score: BenchmarkWorkflowScore = {
    workflow,
    scenarioIds: scenarios.map((scenario) => scenario.id),
    sampleSize: records.length,
    approvalRate: records.length === 0 ? 0 : approvalCount / records.length,
    medianLatencyMs: median(records.map((record) => record.latencyMs)),
    retryRate:
      records.length === 0
        ? 0
        : records.reduce((sum, record) => sum + record.retryCount, 0) / records.length,
    costPerApprovedMinuteUsd:
      totalApprovedMinutes === 0 ? Number.POSITIVE_INFINITY : totalCost / totalApprovedMinutes,
    pass: true,
    failedBudgets: [],
  };

  if (score.approvalRate < strictestBudget.minimumApprovalRate) {
    score.failedBudgets.push("approvalRate");
  }
  if (score.medianLatencyMs > strictestBudget.maximumMedianLatencyMs) {
    score.failedBudgets.push("medianLatencyMs");
  }
  if (score.retryRate > strictestBudget.maximumRetryRate) {
    score.failedBudgets.push("retryRate");
  }
  if (score.costPerApprovedMinuteUsd > strictestBudget.maximumCostPerApprovedMinuteUsd) {
    score.failedBudgets.push("costPerApprovedMinuteUsd");
  }

  score.pass = score.failedBudgets.length === 0;
  return score;
}

export function scoreBenchmarkSuite(
  scenarios: BenchmarkScenario[],
  records: VideoRunTelemetryRecord[]
): BenchmarkReport {
  const workflows = new Map<VideoWorkflowKind, BenchmarkScenario[]>();

  for (const scenario of scenarios) {
    const workflowScenarios = workflows.get(scenario.workflow) ?? [];
    workflowScenarios.push(scenario);
    workflows.set(scenario.workflow, workflowScenarios);
  }

  const scores = Array.from(workflows.entries()).map(([workflow, workflowScenarios]) =>
    scoreWorkflow(
      workflow,
      workflowScenarios,
      records.filter((record) => record.workflow === workflow)
    )
  );

  return {
    generatedAt: new Date().toISOString(),
    scenarioCount: scenarios.length,
    scores,
  };
}

export function renderBenchmarkReport(report: BenchmarkReport): string {
  const lines = [
    `Benchmark report generated at ${report.generatedAt}`,
    `Scenarios: ${report.scenarioCount}`,
  ];

  for (const score of report.scores) {
    lines.push(
      `- ${score.workflow}: sample=${score.sampleSize}, approval=${(score.approvalRate * 100).toFixed(1)}%, medianLatencyMs=${score.medianLatencyMs}, retryRate=${score.retryRate.toFixed(2)}, costPerApprovedMinuteUsd=${Number.isFinite(score.costPerApprovedMinuteUsd) ? score.costPerApprovedMinuteUsd.toFixed(2) : "inf"}, pass=${score.pass ? "yes" : "no"}`
    );
    if (score.failedBudgets.length > 0) {
      lines.push(`  failed budgets: ${score.failedBudgets.join(", ")}`);
    }
  }

  return lines.join("\n");
}
