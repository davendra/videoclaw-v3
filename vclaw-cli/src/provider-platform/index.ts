// Canonical source is now src/video/provider-platform/ in the root project.
// Re-export from the canonical location so veo-cli consumers stay compatible.
export * from "../../../src/video/provider-platform/types.ts";
export * from "../../../src/video/provider-platform/registry.ts";
export * from "../../../src/video/provider-platform/router.ts";
export * from "../../../src/video/provider-platform/telemetry.ts";

// Benchmark files remain local to veo-cli.
export * from "./benchmark";
