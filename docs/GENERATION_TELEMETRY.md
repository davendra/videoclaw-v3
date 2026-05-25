# Generation Telemetry

`videoclaw` records generation telemetry as project events. The goal is
simple: every provider submission and poll should leave enough machine-readable
evidence to answer what route ran, how many tasks were sent, what it cost when
the provider reports cost, how long it took, and how many outputs were ingested.

## Where it is recorded

Telemetry is appended to the existing event ledger:

```text
projects/<slug>/events/events.jsonl
```

Each record uses event type:

```text
generation.telemetry.recorded
```

The payload schema is versioned with `schemaVersion: 1`.

## What is captured

Each telemetry payload can include:

1. `projectSlug`, `routeId`, `operationKind`, `status`, and `dryRun`
2. `taskCount` and `sceneIndices`
3. execution config such as aspect ratio, resolution, audio flag, output count,
   average duration, prompt word count, and reference counts
4. `externalJobId` when live submission or polling exposes one
5. `outputsIngested` after polling
6. provider-reported cost fields: `usd` and/or `creditsCharged`
7. `generationTimeSec` when provider output exposes it
8. `issues` for blocked, failed, or warning-bearing runs

Dry-runs are recorded as telemetry, but they are not used as historical cost
samples.

## Cost-estimate integration

`vclaw video cost-estimate` still uses the static Seedance defaults when there
is no historical provider-reported USD data.

When completed `seedance-direct` telemetry exists with both `cost.usd` and
`taskCount`, project estimates can switch to:

```json
{
  "estimateSource": "historical-telemetry",
  "telemetry": {
    "sampleCount": 1,
    "matchedRouteId": "seedance-direct",
    "averageSeedancePerSceneUsd": 0.5,
    "lastRecordedAt": "2026-05-03T12:00:00.000Z"
  }
}
```

Credits are recorded but not converted to USD. Do not add a conversion unless
the route has an explicit, verified conversion contract.

## Operator guidance

Use telemetry to tune estimates and investigate provider behavior, not to
replace the execution report. The execution report remains the canonical
artifact for the latest execution state; telemetry is the longitudinal ledger
for submissions, polls, costs, durations, and failures.

## Public helpers

The package exports helpers for integration code:

1. `appendGenerationTelemetry`
2. `readProjectGenerationTelemetry`
3. `readPortfolioGenerationTelemetry`
4. `buildGenerationTelemetryFromReport`
5. `buildGenerationTelemetryFromPoll`
6. `findHistoricalSeedanceCostTelemetry`
7. `extractProviderMetrics`
