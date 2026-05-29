import type {
  VideoProviderDescriptor,
  ProviderRoutingPolicy,
  ProviderRouteId,
} from "./types.js";

export const DEFAULT_PROVIDER_REGISTRY: VideoProviderDescriptor[] = [
  {
    id: "veo-direct",
    provider: "veo",
    displayName: "Google Veo Direct",
    path: "direct",
    summary: "Official browser-session path for current Veo coverage with direct account trust.",
    controls: [
      "audio",
      "first-frame",
      "last-frame",
      "reference-images",
      "camera-grammar",
      "world-consistency",
    ],
    operationSupport: [
      {
        operation: "text-to-video",
        aspectRatios: ["landscape", "portrait"],
      },
      {
        operation: "image-to-video",
        aspectRatios: ["landscape"],
        notes: ["Portrait I2V currently regresses on the direct Flow path."],
      },
      {
        operation: "frames-to-video",
        aspectRatios: ["landscape"],
        notes: ["Portrait frames currently require the UseAPI path."],
      },
      {
        operation: "ingredients-to-video",
        aspectRatios: ["landscape", "portrait"],
        maxReferenceImages: 3,
      },
    ],
    routingHints: {
      latencyClass: "medium",
      costClass: "free",
      trustClass: "direct",
      preferredWorkflows: ["generic"],
    },
    escapeHatches: [
      {
        name: "veoModelKey",
        description: "Override Veo model key selection without collapsing to the common contract.",
        options: [
          {
            name: "videoModelKey",
            description: "Direct Flow model key such as veo_3_1_t2v_fast_ultra.",
          },
          {
            name: "userPaygateTier",
            description: "Pass direct account tier data through to the API payload.",
          },
        ],
      },
    ],
    notes: ["Default trust-first route when direct Flow already satisfies capability requirements."],
  },
  {
    id: "veo-useapi",
    provider: "veo",
    displayName: "Google Veo via UseAPI",
    path: "useapi",
    summary: "Aggregator-backed Veo route that unlocks parity gaps and safer automation hooks.",
    controls: [
      "audio",
      "first-frame",
      "last-frame",
      "reference-images",
      "camera-grammar",
      "world-consistency",
    ],
    operationSupport: [
      {
        operation: "text-to-video",
        aspectRatios: ["landscape", "portrait"],
      },
      {
        operation: "image-to-video",
        aspectRatios: ["landscape", "portrait"],
      },
      {
        operation: "frames-to-video",
        aspectRatios: ["landscape", "portrait"],
      },
      {
        operation: "ingredients-to-video",
        aspectRatios: ["landscape", "portrait"],
        maxReferenceImages: 3,
      },
      {
        operation: "video-to-video",
        aspectRatios: ["landscape", "portrait"],
        notes: ["Omni Flash V2V edit via referenceVideo_1. Requires USEAPI_API_TOKEN."],
      },
      {
        operation: "add-audio",
        aspectRatios: ["landscape", "portrait"],
        notes: ["30 voice-narration presets via referenceAudio_1..5."],
      },
    ],
    routingHints: {
      latencyClass: "medium",
      costClass: "low",
      trustClass: "aggregator",
      preferredWorkflows: ["ad-creative-variants", "generic"],
    },
    escapeHatches: [
      {
        name: "useapiVeoOptions",
        description: "Expose UseAPI request-level knobs that are not always safe to normalize globally.",
        options: [
          {
            name: "captchaRetry",
            description: "Override CAPTCHA retry count and provider ordering.",
          },
          {
            name: "replyUrl",
            description: "Attach a UseAPI webhook callback for async orchestration.",
          },
        ],
      },
    ],
    notes: [
      "Preferred when portrait I2V/F2V support is required.",
      "Preserves the existing veo-useapi path.",
      "omni-flash model unlocks video-to-video (V2V) and native add-audio; not available on the direct Flow path.",
    ],
  },
  {
    id: "seedance-direct",
    provider: "seedance",
    displayName: "Seedance 2.0 Direct",
    path: "direct",
    summary: "ByteDance Seedance 2.0 via xskill.ai — excels at artistic, stylized, and product content with I2V support.",
    controls: [
      "first-frame",
      "last-frame",
      "reference-images",
      "motion-control",
      "camera-grammar",
    ],
    operationSupport: [
      {
        operation: "text-to-video",
        aspectRatios: ["landscape", "portrait"],
      },
      {
        operation: "image-to-video",
        aspectRatios: ["landscape", "portrait"],
        maxReferenceImages: 9,
        notes: ["Uses @imageN reference syntax. Images must be China-accessible URLs."],
      },
      {
        operation: "frames-to-video",
        aspectRatios: ["landscape", "portrait"],
        notes: ["Start frame + end frame via @image1 to @image2 syntax."],
      },
      {
        operation: "add-audio",
        aspectRatios: ["landscape", "portrait"],
        notes: ["Audio lipsync via @audio1 reference. Max 15s duration."],
      },
    ],
    routingHints: {
      latencyClass: "medium",
      costClass: "low",
      trustClass: "direct",
      preferredWorkflows: ["generic"],
    },
    escapeHatches: [
      {
        name: "seedanceOptions",
        description: "Seedance-native controls for content filtering and quality mode.",
        options: [
          {
            name: "contentFilterLevel",
            description: "Content filter sanitization level (0=none, 1=light, 2=aggressive).",
          },
          {
            name: "qualityMode",
            description: "Quality mode: fast (seedance_2.0_fast) or quality (seedance_2.0).",
          },
        ],
      },
    ],
    notes: [
      "Direct API via xskill.ai. Requires SUTUI_API_KEY env var.",
      "15s max per generation. Longer videos use segmented stitching.",
      "Chinese prompts produce best results.",
    ],
  },
  {
    id: "runway-useapi",
    provider: "runway",
    displayName: "Runway via UseAPI",
    path: "useapi",
    summary: "First-wave Runway adapter surface oriented around edit-heavy and audio-aware workflows.",
    controls: [
      "audio",
      "first-frame",
      "last-frame",
      "multi-shot",
      "lip-sync",
      "motion-control",
      "reusable-elements",
      "native-extend",
      "native-edit",
      "world-consistency",
    ],
    operationSupport: [
      {
        operation: "text-to-video",
        aspectRatios: ["landscape", "portrait"],
      },
      {
        operation: "image-to-video",
        aspectRatios: ["landscape", "portrait"],
      },
      {
        operation: "extend",
        aspectRatios: ["landscape", "portrait"],
      },
      {
        operation: "edit",
        aspectRatios: ["landscape", "portrait"],
      },
      {
        operation: "add-audio",
        aspectRatios: ["landscape", "portrait"],
      },
    ],
    routingHints: {
      latencyClass: "low",
      costClass: "medium",
      trustClass: "aggregator",
      preferredWorkflows: ["product-demo-spokesperson", "ad-creative-variants"],
    },
    escapeHatches: [
      {
        name: "runwayOptions",
        description: "Preserve Runway-native controls such as multi-shot, lip-sync, and motion intensity.",
        options: [
          {
            name: "multiShot",
            description: "Control shot sequencing and reusable scene elements.",
          },
          {
            name: "lipSyncProfile",
            description: "Choose Runway lip-sync / dialogue controls for spokesperson workflows.",
          },
          {
            name: "audioTrackMode",
            description: "Retain add-audio / replace-audio intent for edit-first workflows.",
          },
        ],
      },
    ],
    notes: [
      "Production native transport (src/video/native-runway.ts) — Seedance-2 via Runway by default; override with VCLAW_RUNWAY_MODEL.",
      "Mode defaults to 'explore' (free, queued, single active slot); set VCLAW_RUNWAY_MODE=credits for paid faster path.",
      "Requires USEAPI_API_TOKEN; account must be pre-registered with UseAPI (see registerRunwayAccount in providers/runway-useapi.ts).",
    ],
  },
  {
    id: "dreamina-useapi",
    provider: "seedance",
    displayName: "Dreamina via UseAPI",
    path: "useapi",
    summary: "Dreamina (CapCut/ByteDance Seed) Seedance 2.0 surface via useapi.net — keyframe i2v plus text-to-video, 1080p on CA accounts.",
    controls: [
      "first-frame",
      "last-frame",
      "reference-images",
      "world-consistency",
    ],
    operationSupport: [
      {
        operation: "text-to-video",
        aspectRatios: ["landscape", "portrait"],
      },
      {
        operation: "image-to-video",
        aspectRatios: ["landscape", "portrait"],
      },
    ],
    routingHints: {
      latencyClass: "medium",
      costClass: "medium",
      trustClass: "aggregator",
      preferredWorkflows: ["ad-creative-variants", "product-demo-spokesperson"],
    },
    escapeHatches: [
      {
        name: "dreaminaOptions",
        description: "Preserve Dreamina-native controls such as model selection and CA-only 1080p output.",
        options: [
          {
            name: "model",
            description: "Choose the Dreamina model (seedance-2.0, seedance-2.0-fast, ...); override with VCLAW_DREAMINA_MODEL.",
          },
          {
            name: "resolution",
            description: "1080p is CA-only; 720p works on both US and CA regions.",
          },
        ],
      },
    ],
    notes: [
      "Production native transport (src/video/native-dreamina.ts) — Seedance 2.0 via Dreamina by default; override with VCLAW_DREAMINA_MODEL.",
      "Requires USEAPI_API_TOKEN plus VCLAW_DREAMINA_ACCOUNT (e.g. 'CA:ai@example.com'); region via VCLAW_DREAMINA_REGION (default CA).",
      "Real human faces are rejected by Seedance content moderation; use illustrated/stylized characters or a Runway-generated start frame.",
    ],
  },
];

export const DEFAULT_ROUTING_POLICY: ProviderRoutingPolicy = {
  tag: "balanced",
  preferDirectForTrust: true,
  preferUseApiWhenCapabilitiesUnlock: true,
  allowDeprecatedProviders: false,
  allowDegradedProviders: true,
  providerOrder: [
    "veo-direct",
    "veo-useapi",
    "seedance-direct",
    "runway-useapi",
    "dreamina-useapi",
  ],
};

export function getProviderDescriptor(routeId: ProviderRouteId): VideoProviderDescriptor {
  const descriptor = DEFAULT_PROVIDER_REGISTRY.find((route) => route.id === routeId);
  if (!descriptor) {
    throw new Error(`Unknown provider route: ${routeId}`);
  }
  return descriptor;
}
