# Provider platform rollout notes

This rollout document captures the Phase 0 / Phase 1 foundation slice for the VideoClaw video-provider platform inside `veo-cli`.

## What landed in this slice

- Normalized provider contract for first-wave routes:
  - `veo-direct`
  - `veo-useapi`
  - `runway-useapi`
  - `kling-useapi`
- Capability-aware routing with explicit fallback ordering and decision traces
- Telemetry schema + JSONL persistence helpers for provider, path, latency, retries, cost, verdict, and failure cause
- Baseline benchmark harness for the two locked workflows:
  - ad creative variants
  - product demo / spokesperson video
- Bundled rollout benchmark definitions in `benchmarks/workflows.phase0.json`

## Direct vs UseAPI routing policy

The initial routing posture is intentionally conservative:

1. Prefer `direct` when it already satisfies the requested capability set and trust/compliance matters more than automation convenience.
2. Prefer `useapi` when it unlocks material coverage gaps or provider-native controls.
3. Keep provider-specific escape hatches visible instead of flattening advanced controls into the lowest common denominator.

### Current implications

- **Veo direct** stays the default trust-first route for common text generation and baseline landscape workflows.
- **Veo UseAPI** is preferred for portrait I2V / portrait F2V because it closes parity gaps on the direct path while preserving existing `veo-useapi` support.
- **Runway UseAPI** is the first-wave edit-native route for add-audio, lip-sync, multi-shot, and extend/edit heavy workflows.
- **Kling UseAPI** is the first-wave motion-control and reusable-element route for ad-variant style iterations.

## Provider-specific escape hatches

The contract is a superset, not a lossy minimum.

- **Veo UseAPI** retains CAPTCHA ordering and webhook callback controls.
- **Runway UseAPI** retains multi-shot, lip-sync profile, and add-audio / replace-audio controls.
- **Kling UseAPI** retains motion strength and reusable-element controls.

Use the escape-hatch payloads when a workflow needs provider-native behavior that should not be forced into the shared baseline.

## Telemetry and benchmark workflow

1. Create a telemetry record with `createTelemetryRecord(...)`.
2. Append it to JSONL with `appendTelemetryRecord(...)`.
3. Score a benchmark run with:

```bash
cd veo-cli
bun run benchmark:smoke
```

That smoke command validates the bundled benchmark suite and emits a sample report for the two locked workflows.

## Near-term follow-up

- Wire the router into live backend selection after the direct / useapi operational paths are ready to consume route decisions safely.
- Replace synthetic smoke records with real baseline telemetry snapshots for both priority workflows.
- Add direct-provider adapters when official Runway / Kling access is preferable to the aggregator path.
