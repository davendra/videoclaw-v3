# Provider Platform

This doc describes `videoclaw-v2`'s provider/transport architecture as of
2026-05-25, after the Phase 1c schema upgrade and the Phase 5b Runway port.

## Routes at a glance

| Route | Maturity | Native transport | Built-in adapter | Required env |
|---|---|---|---|---|
| `veo-direct` | production | `native-veo.ts` → drives `vclaw-cli/flow.ts` (Bun) → Puppeteer Google Flow | — | `cookie.json` in `vclaw-cli/` |
| `veo-useapi` | production | — | `vclaw-provider-adapter --route veo-useapi` | `USEAPI_API_TOKEN`, `USEAPI_ACCOUNT_EMAIL` |
| `seedance-direct` | production | `native-seedance.ts` (uses `SUTUI_API_KEY`) | `vclaw-provider-adapter --route seedance-direct` | `SUTUI_API_KEY` |
| `runway-useapi` | production | `native-runway.ts` (pure Node fetch+fs) | `vclaw-provider-adapter --route runway-useapi` | `USEAPI_API_TOKEN`, `USEAPI_ACCOUNT_EMAIL` |
| `kling-useapi` | scaffold | — | — | (scaffold only — adapter not yet written; set `VCLAW_KLING_USEAPI_ADAPTER` to your own implementation) |

## Descriptor schema

`src/video/provider-platform/registry.ts` defines `DEFAULT_PROVIDER_REGISTRY`
as an array of `VideoProviderDescriptor` (from `./types.ts`). Each route
descriptor has:

```typescript
interface VideoProviderDescriptor {
  id: ProviderRouteId;                     // 'veo-direct' | 'veo-useapi' | ...
  provider: VideoProvider;                 // 'veo' | 'seedance' | 'runway' | 'kling'
  displayName: string;
  path: ProviderPath;                      // 'direct' | 'useapi'
  summary: string;
  controls: ProviderControl[];             // 'audio', 'first-frame', 'last-frame',
                                           // 'reference-images', 'camera-grammar', ...
  operationSupport: Array<{
    operation: VideoOperationKind;         // 'text-to-video', 'image-to-video', ...
    aspectRatios: NormalizedAspectRatio[];  // 'landscape' | 'portrait'
    notes?: string[];                      // per-operation gotchas
    maxReferenceImages?: number;
  }>;
  routingHints: {
    latencyClass: 'low' | 'medium' | 'high';
    costClass: 'free' | 'paid' | 'premium';
    trustClass: 'direct' | 'aggregated';
    preferredWorkflows: VideoWorkflowKind[];
  };
  escapeHatches?: Array<{
    name: string;
    description: string;
    options: Array<{ name: string; description: string }>;
  }>;
  notes?: string[];                        // free-form per-route notes
}
```

This rich schema came from videoclaw during the Phase 1c merge. It replaced
the flat `supportedOperations[]` shape that `vclaw-video-core` had, and
lets the router make capability-aware decisions per operation × aspect ratio
rather than per route as a whole.

## Routing

`src/video/provider-platform/router.ts` exposes
`chooseVideoProviderRoute(request, policy)`. Given a routing request with
operation kind + aspect ratio + capability requirements, it filters routes
that satisfy the operation × aspectRatio combination, ranks the remainders
by the policy's preference (`trust-first`, `capability-first`, or
`balanced`), and returns a `VideoProviderRouteDecision` with the chosen
route + rationale.

Routes marked `scaffold` in `provider-status.ts:ROUTE_MATURITY` are
labeled `availability: 'degraded'` in the status report and the router
will skip them under default policy unless explicitly requested.

## Adapter contract

Live execution goes through `src/video/execution-runtime.ts`, which calls
`resolveAdapterCommand(routeId, env)`:

1. Look for the user override env var (`VCLAW_<ROUTE>_ADAPTER`). If set,
   that command runs as the adapter — `vclaw` invokes it with JSON on
   stdin and expects JSON on stdout.
2. Otherwise check `builtinAdapterCommandForRoute(routeId)`. Currently
   returns a built-in adapter command for `seedance-direct`, `veo-useapi`,
   and `runway-useapi` (the bundled `dist/cli/provider-adapter.js` binary
   invoked with `--route <id>`).
3. Otherwise throw — the route doesn't have a usable adapter.

The adapter protocol:

| Stage | Input (stdin) | Output (stdout) |
|---|---|---|
| submit | `{ scenes: [{ sceneIndex, prompt, ... }], outputDir, ... }` | `{ externalJobId, rawResult: {...} }` |
| poll | `{ outputDir, externalJobId }` | `{ status: 'pending' \| 'completed' \| 'failed', outputs?: [...], issues?: [...] }` |
| cancel | `{ outputDir, externalJobId }` | `{ canceled: true, warnings?: [...] }` |

## Native in-process transports

Three routes have native TypeScript transports that bypass the adapter
subprocess hop:

- **`src/video/native-veo.ts`** — defaults to `<workspace>/vclaw-cli/flow.ts`
  via `bun`. Looks for `cookie.json` for Google Labs Flow auth.
  Customizable via `VCLAW_VEO_CLI_ROOT`, `VCLAW_VEO_OUTPUT_DIR`,
  `VCLAW_VEO_BUN_BIN`, `VCLAW_VEO_COMMAND_TIMEOUT_MS`.

- **`src/video/native-seedance.ts`** — direct Seedance API calls via
  `SUTUI_API_KEY`. No subprocess hop, no external CLI dependency.

- **`src/video/native-runway.ts`** — direct UseAPI REST calls via
  `USEAPI_API_TOKEN` + `USEAPI_ACCOUNT_EMAIL`. Pure Node `fetch` + `fs`.
  Supports both Gen-4.x (firstImageAssetId for i2v) and Seedance-2.0
  (startFrameAssetId for keyframe-driven) modes via the unified
  `/runwayml/videos/create` endpoint. Cancel marks scenes failed locally
  and warns about remote tasks UseAPI free-tier cannot cancel server-side.

All three accept an optional `fetchImpl` parameter for test injection.
The provider-level adapter functions in `src/video/providers/runway-useapi.ts`
also accept `fetchImpl`, so tests can mock the entire HTTP layer
end-to-end.

## Adding a new route

When you want to add a working `kling-useapi` route (or any other
provider):

1. **Descriptor.** Add a `VideoProviderDescriptor` entry to
   `DEFAULT_PROVIDER_REGISTRY` in `src/video/provider-platform/registry.ts`.
   Use videoclaw's rich schema (controls, operationSupport, routingHints,
   escapeHatches).
2. **Provider HTTP code.** Add `src/video/providers/<route>.ts` with the
   submit/poll/fetchResult functions. Accept `fetchImpl?: FetchLike` in
   each input interface for test injection.
3. **Native transport.** Add `src/video/native-<route>.ts` mirroring
   `native-runway.ts`: own workspace/env/job-state, call into providers/
   for HTTP. Accept `fetchImpl?: FetchLike` in the options.
4. **Wire the dispatcher.** In `src/video/execution-runtime.ts`, add a
   case for the new route in `builtinAdapterCommandForRoute()` and
   `adapterEnvVarForRoute()`. In
   `src/video/provider-adapter-runner.ts`, route the submit/poll/cancel
   payloads to your native module.
5. **Status.** In `src/video/provider-status.ts`, update
   `ROUTE_MATURITY[<route>]` to `'production'`,
   `ROUTE_REQUIRED_ENV_VARS[<route>]`, `ROUTE_REQUIRED_DEPENDENCIES[<route>]`,
   and `ROUTE_ADAPTER_ENV_VAR[<route>]`.
6. **Tests.** Add `src/tests/<route>.test.ts` (provider) and
   `src/tests/native-<route>.test.ts` (native wrapper with scripted
   fetch mock). The 4 runway tests are the reference pattern.
7. **Docs.** Update the route table at the top of this file.

`runway-useapi` is the most recent working example — it landed in Phase 5b
(`6e99443`). Read those files for the canonical structure.
