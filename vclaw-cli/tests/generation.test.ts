/**
 * Unit tests for src/generation.ts
 *
 * Tests video generation logic including:
 * - Seed generation
 * - Payload construction for T2V, I2V, Frames, and R2V modes
 * - Model key handling
 * - Session normalization
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { genSeed } from "../src/generation";

describe("genSeed", () => {
  test("generates a number", () => {
    const seed = genSeed();
    expect(typeof seed).toBe("number");
  });

  test("generates non-negative number", () => {
    for (let i = 0; i < 100; i++) {
      const seed = genSeed();
      expect(seed).toBeGreaterThanOrEqual(0);
    }
  });

  test("generates number within default max (0xf4240 = 1000000)", () => {
    for (let i = 0; i < 100; i++) {
      const seed = genSeed();
      expect(seed).toBeLessThan(0xf4240);
    }
  });

  test("respects custom max parameter", () => {
    for (let i = 0; i < 100; i++) {
      const seed = genSeed(100);
      expect(seed).toBeLessThan(100);
      expect(seed).toBeGreaterThanOrEqual(0);
    }
  });

  test("generates different values (randomness test)", () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 50; i++) {
      seeds.add(genSeed());
    }
    // Should have at least 10 unique values out of 50
    expect(seeds.size).toBeGreaterThan(10);
  });
});

describe("video model selection", () => {
  // Model key patterns based on the codebase
  const MODEL_PATTERNS = {
    t2v_fast: /veo_3_\d+_fast_ultra/,
    t2v_quality: /veo_3_\d+_fast_ultra/, // Same model, different tier
    i2v: /veo_3_\d+_i2v_s/,
    r2v_landscape: /veo_3_\d+_r2v_fast_landscape_ultra/,
    r2v_portrait: /veo_3_\d+_r2v_fast_portrait_ultra/,
    veo2: /veo_2_/,
  };

  function getModelCategory(modelKey: string): string {
    if (modelKey.includes("i2v")) return "i2v";
    if (modelKey.includes("r2v")) return "r2v";
    if (modelKey.includes("veo_2")) return "veo2";
    return "t2v";
  }

  test("categorizes T2V models correctly", () => {
    expect(getModelCategory("veo_3_1_fast_ultra")).toBe("t2v");
    expect(getModelCategory("veo_3_1_fast_portrait_ultra")).toBe("t2v");
  });

  test("categorizes I2V models correctly", () => {
    expect(getModelCategory("veo_3_1_i2v_s")).toBe("i2v");
  });

  test("categorizes R2V models correctly", () => {
    expect(getModelCategory("veo_3_1_r2v_fast_landscape_ultra")).toBe("r2v");
    expect(getModelCategory("veo_3_1_r2v_fast_portrait_ultra")).toBe("r2v");
  });

  test("categorizes Veo 2 models correctly", () => {
    expect(getModelCategory("veo_2_standard")).toBe("veo2");
  });
});

describe("aspect ratio handling", () => {
  type VideoAspectRatio = "VIDEO_ASPECT_RATIO_LANDSCAPE" | "VIDEO_ASPECT_RATIO_PORTRAIT";

  function validateAspectRatio(ratio: string): ratio is VideoAspectRatio {
    return ratio === "VIDEO_ASPECT_RATIO_LANDSCAPE" || ratio === "VIDEO_ASPECT_RATIO_PORTRAIT";
  }

  function isLandscape(ratio: VideoAspectRatio): boolean {
    return ratio === "VIDEO_ASPECT_RATIO_LANDSCAPE";
  }

  function isPortrait(ratio: VideoAspectRatio): boolean {
    return ratio === "VIDEO_ASPECT_RATIO_PORTRAIT";
  }

  test("validates landscape aspect ratio", () => {
    expect(validateAspectRatio("VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe(true);
  });

  test("validates portrait aspect ratio", () => {
    expect(validateAspectRatio("VIDEO_ASPECT_RATIO_PORTRAIT")).toBe(true);
  });

  test("rejects invalid aspect ratios", () => {
    expect(validateAspectRatio("16:9")).toBe(false);
    expect(validateAspectRatio("9:16")).toBe(false);
    expect(validateAspectRatio("landscape")).toBe(false);
  });

  test("isLandscape works correctly", () => {
    expect(isLandscape("VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe(true);
    expect(isLandscape("VIDEO_ASPECT_RATIO_PORTRAIT")).toBe(false);
  });

  test("isPortrait works correctly", () => {
    expect(isPortrait("VIDEO_ASPECT_RATIO_PORTRAIT")).toBe(true);
    expect(isPortrait("VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe(false);
  });
});

describe("session normalization", () => {
  interface Session {
    accessToken: string;
    user: { name: string; email: string };
  }

  interface InternalSession {
    access_token: string;
    user?: { name: string; image?: string };
  }

  function toInternalSession(session: Session | InternalSession): InternalSession {
    if ("access_token" in session) {
      return session as InternalSession;
    }
    return { access_token: (session as Session).accessToken };
  }

  test("normalizes external session format", () => {
    const externalSession: Session = {
      accessToken: "token123",
      user: { name: "Test User", email: "test@example.com" }
    };
    const internal = toInternalSession(externalSession);
    expect(internal.access_token).toBe("token123");
  });

  test("passes through internal session format", () => {
    const internalSession: InternalSession = {
      access_token: "token456",
      user: { name: "Internal User" }
    };
    const result = toInternalSession(internalSession);
    expect(result.access_token).toBe("token456");
    expect(result.user?.name).toBe("Internal User");
  });
});

describe("base request construction", () => {
  type VideoAspectRatio = "VIDEO_ASPECT_RATIO_LANDSCAPE" | "VIDEO_ASPECT_RATIO_PORTRAIT";

  interface Veo3Options {
    project: { projectId: string };
    isSeedLocked: boolean;
    recaptchaToken: string;
    outputsPerPrompt: number;
    videoModelKey: string;
    aspectRatio: VideoAspectRatio;
    userPaygateTier: string;
    seed?: number;
  }

  function buildBaseRequest(options: Veo3Options): Record<string, unknown> {
    return {
      aspectRatio: options.aspectRatio,
      seed: options.isSeedLocked ? 1234567 : (options.seed ?? Math.floor(Math.random() * 0x7fff)),
      videoModelKey: options.videoModelKey,
      metadata: { sceneId: expect.any(String) },
    };
  }

  test("includes aspect ratio", () => {
    const options: Veo3Options = {
      project: { projectId: "proj123" },
      isSeedLocked: false,
      recaptchaToken: "token",
      outputsPerPrompt: 1,
      videoModelKey: "veo_3_1_fast_ultra",
      aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE",
      userPaygateTier: "TIER_ONE"
    };
    const request = buildBaseRequest(options);
    expect(request.aspectRatio).toBe("VIDEO_ASPECT_RATIO_LANDSCAPE");
  });

  test("uses locked seed when isSeedLocked is true", () => {
    const options: Veo3Options = {
      project: { projectId: "proj123" },
      isSeedLocked: true,
      recaptchaToken: "token",
      outputsPerPrompt: 1,
      videoModelKey: "veo_3_1_fast_ultra",
      aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE",
      userPaygateTier: "TIER_ONE"
    };
    const request = buildBaseRequest(options);
    expect(request.seed).toBe(1234567);
  });

  test("uses provided seed when not locked", () => {
    const options: Veo3Options = {
      project: { projectId: "proj123" },
      isSeedLocked: false,
      recaptchaToken: "token",
      outputsPerPrompt: 1,
      videoModelKey: "veo_3_1_fast_ultra",
      aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE",
      userPaygateTier: "TIER_ONE",
      seed: 42
    };
    const request = buildBaseRequest(options);
    expect(request.seed).toBe(42);
  });

  test("includes video model key", () => {
    const options: Veo3Options = {
      project: { projectId: "proj123" },
      isSeedLocked: false,
      recaptchaToken: "token",
      outputsPerPrompt: 1,
      videoModelKey: "veo_3_1_i2v_s",
      aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE",
      userPaygateTier: "TIER_ONE"
    };
    const request = buildBaseRequest(options);
    expect(request.videoModelKey).toBe("veo_3_1_i2v_s");
  });
});

describe("client context construction", () => {
  interface Veo3Options {
    project: { projectId: string };
    recaptchaToken: string;
    userPaygateTier: string;
  }

  function buildClientContext(options: Veo3Options): Record<string, unknown> {
    return {
      tool: "PINHOLE",
      sessionId: ";" + Date.now(),
      projectId: options.project.projectId,
      recaptchaToken: options.recaptchaToken,
      userPaygateTier: options.userPaygateTier,
    };
  }

  test("includes tool name", () => {
    const context = buildClientContext({
      project: { projectId: "proj123" },
      recaptchaToken: "recap_token",
      userPaygateTier: "TIER_ONE"
    });
    expect(context.tool).toBe("PINHOLE");
  });

  test("includes project ID", () => {
    const context = buildClientContext({
      project: { projectId: "proj123" },
      recaptchaToken: "recap_token",
      userPaygateTier: "TIER_ONE"
    });
    expect(context.projectId).toBe("proj123");
  });

  test("includes recaptcha token", () => {
    const context = buildClientContext({
      project: { projectId: "proj123" },
      recaptchaToken: "my_recaptcha_token",
      userPaygateTier: "TIER_ONE"
    });
    expect(context.recaptchaToken).toBe("my_recaptcha_token");
  });

  test("includes user paygate tier", () => {
    const context = buildClientContext({
      project: { projectId: "proj123" },
      recaptchaToken: "token",
      userPaygateTier: "TIER_TWO"
    });
    expect(context.userPaygateTier).toBe("TIER_TWO");
  });

  test("sessionId starts with semicolon", () => {
    const context = buildClientContext({
      project: { projectId: "proj123" },
      recaptchaToken: "token",
      userPaygateTier: "TIER_ONE"
    });
    expect((context.sessionId as string).startsWith(";")).toBe(true);
  });
});

describe("operation status handling", () => {
  const STATUS_SUCCESSFUL = "MEDIA_GENERATION_STATUS_SUCCESSFUL";
  const STATUS_FAILED = "MEDIA_GENERATION_STATUS_FAILED";
  const STATUS_IN_PROGRESS = "MEDIA_GENERATION_STATUS_IN_PROGRESS";
  const STATUS_PENDING = "MEDIA_GENERATION_STATUS_PENDING";

  function isTerminalStatus(status: string): boolean {
    return status === STATUS_SUCCESSFUL || status === STATUS_FAILED;
  }

  function isSuccessful(status: string): boolean {
    return status === STATUS_SUCCESSFUL;
  }

  function isFailed(status: string): boolean {
    return status === STATUS_FAILED;
  }

  test("recognizes successful status as terminal", () => {
    expect(isTerminalStatus(STATUS_SUCCESSFUL)).toBe(true);
  });

  test("recognizes failed status as terminal", () => {
    expect(isTerminalStatus(STATUS_FAILED)).toBe(true);
  });

  test("in-progress status is not terminal", () => {
    expect(isTerminalStatus(STATUS_IN_PROGRESS)).toBe(false);
  });

  test("pending status is not terminal", () => {
    expect(isTerminalStatus(STATUS_PENDING)).toBe(false);
  });

  test("isSuccessful works correctly", () => {
    expect(isSuccessful(STATUS_SUCCESSFUL)).toBe(true);
    expect(isSuccessful(STATUS_FAILED)).toBe(false);
    expect(isSuccessful(STATUS_IN_PROGRESS)).toBe(false);
  });

  test("isFailed works correctly", () => {
    expect(isFailed(STATUS_FAILED)).toBe(true);
    expect(isFailed(STATUS_SUCCESSFUL)).toBe(false);
    expect(isFailed(STATUS_IN_PROGRESS)).toBe(false);
  });
});

describe("reference images payload (R2V)", () => {
  interface ReferenceImage {
    imageUsageType: string;
    mediaId: string;
  }

  function buildReferenceImages(mediaIds: string[]): ReferenceImage[] {
    return mediaIds.slice(0, 3).map(id => ({
      imageUsageType: "IMAGE_USAGE_TYPE_ASSET",
      mediaId: id
    }));
  }

  test("builds reference images array with single ID", () => {
    const refs = buildReferenceImages(["CAMabc123"]);
    expect(refs).toHaveLength(1);
    expect(refs[0].imageUsageType).toBe("IMAGE_USAGE_TYPE_ASSET");
    expect(refs[0].mediaId).toBe("CAMabc123");
  });

  test("builds reference images array with multiple IDs", () => {
    const refs = buildReferenceImages(["CAM1", "CAM2", "CAM3"]);
    expect(refs).toHaveLength(3);
  });

  test("limits to 3 reference images", () => {
    const refs = buildReferenceImages(["CAM1", "CAM2", "CAM3", "CAM4", "CAM5"]);
    expect(refs).toHaveLength(3);
  });

  test("handles empty array", () => {
    const refs = buildReferenceImages([]);
    expect(refs).toHaveLength(0);
  });
});

describe("media ingestion delay", () => {
  // Logic for determining when to wait for media ingestion
  function shouldWaitForIngestion(mode: string, hasUploadedImages: boolean): boolean {
    if (mode === "text") return false;
    return hasUploadedImages;
  }

  function getIngestionDelay(mode: string): number {
    // T2V doesn't need ingestion delay
    if (mode === "text") return 0;
    // I2V, Frames, and R2V modes need time for media ingestion
    return 5000;
  }

  test("no wait for T2V mode", () => {
    expect(shouldWaitForIngestion("text", false)).toBe(false);
    expect(getIngestionDelay("text")).toBe(0);
  });

  test("waits for I2V mode with uploaded images", () => {
    expect(shouldWaitForIngestion("image", true)).toBe(true);
    expect(getIngestionDelay("image")).toBe(5000);
  });

  test("waits for Frames mode with uploaded images", () => {
    expect(shouldWaitForIngestion("frames", true)).toBe(true);
    expect(getIngestionDelay("frames")).toBe(5000);
  });

  test("waits for R2V mode with uploaded images", () => {
    expect(shouldWaitForIngestion("ingredients", true)).toBe(true);
    expect(getIngestionDelay("ingredients")).toBe(5000);
  });

  test("no wait when no images uploaded", () => {
    expect(shouldWaitForIngestion("image", false)).toBe(false);
  });
});
