/**
 * Unit tests for src/config.ts
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  mapAspectRatio,
  mapModelKey,
  getModelCredits,
  getModelDisplayName,
  resolvePath,
  setQuietMode,
  log,
  DEFAULT_CONFIG,
  MODEL_CREDITS,
} from "../src/config";

describe("mapAspectRatio", () => {
  test("maps 'landscape' to VIDEO_ASPECT_RATIO_LANDSCAPE", () => {
    expect(mapAspectRatio("landscape")).toBe("VIDEO_ASPECT_RATIO_LANDSCAPE");
  });

  test("maps 'portrait' to VIDEO_ASPECT_RATIO_PORTRAIT", () => {
    expect(mapAspectRatio("portrait")).toBe("VIDEO_ASPECT_RATIO_PORTRAIT");
  });

  test("maps '16:9' to VIDEO_ASPECT_RATIO_LANDSCAPE", () => {
    expect(mapAspectRatio("16:9")).toBe("VIDEO_ASPECT_RATIO_LANDSCAPE");
  });

  test("maps '9:16' to VIDEO_ASPECT_RATIO_PORTRAIT", () => {
    expect(mapAspectRatio("9:16")).toBe("VIDEO_ASPECT_RATIO_PORTRAIT");
  });

  test("is case-insensitive", () => {
    expect(mapAspectRatio("LANDSCAPE")).toBe("VIDEO_ASPECT_RATIO_LANDSCAPE");
    expect(mapAspectRatio("Portrait")).toBe("VIDEO_ASPECT_RATIO_PORTRAIT");
    expect(mapAspectRatio("LandScape")).toBe("VIDEO_ASPECT_RATIO_LANDSCAPE");
  });

  test("defaults to landscape for unknown values", () => {
    expect(mapAspectRatio("unknown")).toBe("VIDEO_ASPECT_RATIO_LANDSCAPE");
    expect(mapAspectRatio("")).toBe("VIDEO_ASPECT_RATIO_LANDSCAPE");
    expect(mapAspectRatio("square")).toBe("VIDEO_ASPECT_RATIO_LANDSCAPE");
  });
});

describe("mapModelKey", () => {
  describe("quality model", () => {
    test("text mode landscape returns veo_3_1_t2v", () => {
      expect(mapModelKey("quality", "text", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_3_1_t2v");
    });

    test("text mode portrait returns veo_3_1_t2v_portrait", () => {
      expect(mapModelKey("quality", "text", "VIDEO_ASPECT_RATIO_PORTRAIT")).toBe("veo_3_1_t2v_portrait");
    });

    test("image mode landscape returns veo_3_1_i2v_s", () => {
      expect(mapModelKey("quality", "image", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_3_1_i2v_s");
    });

    test("image mode portrait returns veo_3_1_i2v_s (no portrait suffix, uses aspectRatio in request)", () => {
      expect(mapModelKey("quality", "image", "VIDEO_ASPECT_RATIO_PORTRAIT")).toBe("veo_3_1_i2v_s");
    });

    test("frames mode returns i2v model", () => {
      expect(mapModelKey("quality", "frames", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_3_1_i2v_s");
    });

    test("ingredients mode returns R2V model with landscape suffix", () => {
      expect(mapModelKey("quality", "ingredients", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_3_1_r2v_fast_landscape_ultra");
    });

    test("ingredients mode portrait returns R2V model with portrait suffix", () => {
      expect(mapModelKey("quality", "ingredients", "VIDEO_ASPECT_RATIO_PORTRAIT")).toBe("veo_3_1_r2v_fast_portrait_ultra");
    });
  });

  describe("fast model", () => {
    test("text mode landscape returns veo_3_1_t2v_fast_ultra", () => {
      expect(mapModelKey("fast", "text", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_3_1_t2v_fast_ultra");
    });

    test("text mode portrait returns veo_3_1_t2v_fast_portrait_ultra", () => {
      expect(mapModelKey("fast", "text", "VIDEO_ASPECT_RATIO_PORTRAIT")).toBe("veo_3_1_t2v_fast_portrait_ultra");
    });

    test("image mode landscape returns veo_3_1_i2v_s (base I2V model)", () => {
      expect(mapModelKey("fast", "image", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_3_1_i2v_s");
    });

    test("image mode portrait returns veo_3_1_i2v_s (base I2V model, aspectRatio in request)", () => {
      expect(mapModelKey("fast", "image", "VIDEO_ASPECT_RATIO_PORTRAIT")).toBe("veo_3_1_i2v_s");
    });

    test("ingredients mode landscape returns R2V fast landscape model", () => {
      expect(mapModelKey("fast", "ingredients", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_3_1_r2v_fast_landscape_ultra");
    });

    test("ingredients mode portrait returns R2V fast portrait model", () => {
      expect(mapModelKey("fast", "ingredients", "VIDEO_ASPECT_RATIO_PORTRAIT")).toBe("veo_3_1_r2v_fast_portrait_ultra");
    });
  });

  describe("free model", () => {
    test("text mode landscape returns veo_3_1_t2v_fast_ultra_relaxed", () => {
      expect(mapModelKey("free", "text", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_3_1_t2v_fast_ultra_relaxed");
    });

    test("text mode portrait returns veo_3_1_t2v_fast_portrait_ultra_relaxed", () => {
      expect(mapModelKey("free", "text", "VIDEO_ASPECT_RATIO_PORTRAIT")).toBe("veo_3_1_t2v_fast_portrait_ultra_relaxed");
    });

    test("image mode landscape returns veo_3_1_i2v_s (base I2V model)", () => {
      expect(mapModelKey("free", "image", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_3_1_i2v_s");
    });

    test("image mode portrait returns veo_3_1_i2v_s (base I2V model, aspectRatio in request)", () => {
      expect(mapModelKey("free", "image", "VIDEO_ASPECT_RATIO_PORTRAIT")).toBe("veo_3_1_i2v_s");
    });

    test("ingredients mode landscape returns R2V relaxed landscape model", () => {
      expect(mapModelKey("free", "ingredients", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_3_1_r2v_fast_landscape_ultra_relaxed");
    });

    test("ingredients mode portrait returns R2V relaxed portrait model", () => {
      expect(mapModelKey("free", "ingredients", "VIDEO_ASPECT_RATIO_PORTRAIT")).toBe("veo_3_1_r2v_fast_portrait_ultra_relaxed");
    });
  });

  describe("veo2 model", () => {
    test("text mode returns veo_2_0_t2v (ignores aspect ratio)", () => {
      expect(mapModelKey("veo2", "text", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_2_0_t2v");
      expect(mapModelKey("veo2", "text", "VIDEO_ASPECT_RATIO_PORTRAIT")).toBe("veo_2_0_t2v");
    });

    test("image mode returns veo_2_0_i2v (ignores aspect ratio)", () => {
      expect(mapModelKey("veo2", "image", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_2_0_i2v");
      expect(mapModelKey("veo2", "image", "VIDEO_ASPECT_RATIO_PORTRAIT")).toBe("veo_2_0_i2v");
    });

    test("ingredients mode falls back to Veo 3.1 R2V (no veo2 R2V exists)", () => {
      expect(mapModelKey("veo2", "ingredients", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_3_1_r2v_fast_landscape_ultra");
      expect(mapModelKey("veo2", "ingredients", "VIDEO_ASPECT_RATIO_PORTRAIT")).toBe("veo_3_1_r2v_fast_portrait_ultra");
    });
  });

  describe("case insensitivity", () => {
    test("accepts uppercase model names", () => {
      expect(mapModelKey("QUALITY", "text", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_3_1_t2v");
      expect(mapModelKey("FAST", "text", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_3_1_t2v_fast_ultra");
      expect(mapModelKey("FREE", "text", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_3_1_t2v_fast_ultra_relaxed");
      expect(mapModelKey("VEO2", "text", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_2_0_t2v");
    });

    test("accepts mixed case model names", () => {
      expect(mapModelKey("Quality", "text", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_3_1_t2v");
      expect(mapModelKey("Fast", "image", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_3_1_i2v_s");
    });
  });

  describe("passthrough for unknown models", () => {
    test("passes through full model names unchanged", () => {
      expect(mapModelKey("veo_3_1_custom_model", "text", "VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("veo_3_1_custom_model");
      expect(mapModelKey("some_other_model", "image", "VIDEO_ASPECT_RATIO_PORTRAIT")).toBe("some_other_model");
    });
  });
});

describe("getModelCredits", () => {
  test("quality returns 100", () => {
    expect(getModelCredits("quality")).toBe(100);
  });

  test("fast returns 10", () => {
    expect(getModelCredits("fast")).toBe(10);
  });

  test("free returns 0", () => {
    expect(getModelCredits("free")).toBe(0);
  });

  test("veo2 returns 100", () => {
    expect(getModelCredits("veo2")).toBe(100);
  });

  test("is case-insensitive", () => {
    expect(getModelCredits("QUALITY")).toBe(100);
    expect(getModelCredits("Fast")).toBe(10);
    expect(getModelCredits("FREE")).toBe(0);
    expect(getModelCredits("VEO2")).toBe(100);
  });

  test("defaults to 10 for unknown models", () => {
    expect(getModelCredits("unknown")).toBe(10);
    expect(getModelCredits("")).toBe(10);
    expect(getModelCredits("custom_model")).toBe(10);
  });
});

describe("getModelDisplayName", () => {
  test("quality returns descriptive name", () => {
    expect(getModelDisplayName("quality")).toBe("Veo 3.1 Quality (100 credits)");
  });

  test("fast returns descriptive name", () => {
    expect(getModelDisplayName("fast")).toBe("Veo 3.1 Fast (10 credits)");
  });

  test("free returns descriptive name", () => {
    expect(getModelDisplayName("free")).toBe("Veo 3.1 Free (0 credits)");
  });

  test("veo2 returns descriptive name with no audio note", () => {
    expect(getModelDisplayName("veo2")).toBe("Veo 2.0 (100 credits, no audio)");
  });

  test("is case-insensitive", () => {
    expect(getModelDisplayName("QUALITY")).toBe("Veo 3.1 Quality (100 credits)");
    expect(getModelDisplayName("Fast")).toBe("Veo 3.1 Fast (10 credits)");
  });

  test("returns input for unknown models", () => {
    expect(getModelDisplayName("custom_model")).toBe("custom_model");
    expect(getModelDisplayName("veo_3_1_t2v_fast_ultra")).toBe("veo_3_1_t2v_fast_ultra");
  });
});

describe("resolvePath", () => {
  test("returns absolute paths unchanged", () => {
    expect(resolvePath("/absolute/path/to/file")).toBe("/absolute/path/to/file");
    expect(resolvePath("/")).toBe("/");
  });

  test("returns tilde paths unchanged", () => {
    expect(resolvePath("~/documents/file.txt")).toBe("~/documents/file.txt");
    expect(resolvePath("~")).toBe("~");
  });

  test("resolves relative paths to CWD", () => {
    const cwd = process.cwd();
    expect(resolvePath("./file.txt")).toBe(`${cwd}/file.txt`);
    expect(resolvePath("file.txt")).toBe(`${cwd}/file.txt`);
    expect(resolvePath("subdir/file.txt")).toBe(`${cwd}/subdir/file.txt`);
  });

  test("handles paths with dot-dot (normalizes)", () => {
    // join() normalizes the path, so ../file.txt from /a/b becomes /a/file.txt
    const result = resolvePath("../file.txt");
    expect(result.endsWith("file.txt")).toBe(true);
    expect(result.startsWith("/")).toBe(true);
  });
});

describe("setQuietMode and log", () => {
  let consoleLogs: string[] = [];
  const originalLog = console.log;

  beforeEach(() => {
    consoleLogs = [];
    console.log = (...args: any[]) => {
      consoleLogs.push(args.join(" "));
    };
    // Reset quiet mode
    setQuietMode(false);
  });

  test("log outputs when quiet mode is false", () => {
    setQuietMode(false);
    log("test message");
    expect(consoleLogs).toContain("test message");
  });

  test("log does not output when quiet mode is true", () => {
    setQuietMode(true);
    log("test message");
    expect(consoleLogs).not.toContain("test message");
    expect(consoleLogs.length).toBe(0);
  });

  test("quiet mode can be toggled", () => {
    setQuietMode(true);
    log("first");
    setQuietMode(false);
    log("second");
    setQuietMode(true);
    log("third");

    expect(consoleLogs).toEqual(["second"]);
  });

  // Restore console.log after tests
  test.todo("cleanup console.log mock", () => {});
});

describe("DEFAULT_CONFIG", () => {
  test("has correct default paths", () => {
    expect(DEFAULT_CONFIG.paths.prompts).toBe("./prompts.txt");
    expect(DEFAULT_CONFIG.paths.cookies).toBe("./cookie.json");
    expect(DEFAULT_CONFIG.paths.outputDir).toBe("./output-videos");
  });

  test("has headless true by default", () => {
    expect(DEFAULT_CONFIG.browser.headless).toBe(true);
  });

  test("has quiet false by default", () => {
    expect(DEFAULT_CONFIG.quiet).toBe(false);
  });

  test("has correct default timing values", () => {
    expect(DEFAULT_CONFIG.timing.pollIntervalMs).toBe(3000);
    expect(DEFAULT_CONFIG.timing.maxPollAttempts).toBe(250);
    expect(DEFAULT_CONFIG.timing.requestTimeoutMs).toBe(30000);
    expect(DEFAULT_CONFIG.timing.downloadTimeoutMs).toBe(300000);
    expect(DEFAULT_CONFIG.timing.interPromptDelayMs).toBe(30000);
    expect(DEFAULT_CONFIG.timing.loginWaitMs).toBe(60000);
  });

  test("has correct default video settings", () => {
    expect(DEFAULT_CONFIG.video.outputsPerPrompt).toBe(1);
    expect(DEFAULT_CONFIG.video.isSeedLocked).toBe(false);
    expect(DEFAULT_CONFIG.video.seed).toBeNull();
    expect(DEFAULT_CONFIG.video.preferredAspectRatio).toBeNull();
    expect(DEFAULT_CONFIG.video.preferredModel).toBeNull();
    expect(DEFAULT_CONFIG.video.audioEnabled).toBe(true);
  });
});

describe("MODEL_CREDITS", () => {
  test("has quality model at 100 credits", () => {
    expect(MODEL_CREDITS["veo_3_1_t2v_quality_ultra"]).toBe(100);
    expect(MODEL_CREDITS["veo_3_1_i2v_s_quality_ultra"]).toBe(100);
  });

  test("has fast model at 10 credits", () => {
    expect(MODEL_CREDITS["veo_3_1_t2v_fast_ultra"]).toBe(10);
    expect(MODEL_CREDITS["veo_3_1_i2v_s_fast_ultra"]).toBe(10);
  });

  test("has free model at 0 credits", () => {
    expect(MODEL_CREDITS["veo_3_1_t2v_fast_ultra_free"]).toBe(0);
  });

  test("has veo2 model at 100 credits", () => {
    expect(MODEL_CREDITS["veo_2_t2v_quality_ultra"]).toBe(100);
  });
});
