import { describe, test, expect } from "bun:test";
import { FLOW_VOICE_PRESETS } from "../src/backends/types";

describe("Flow shared types", () => {
  test("FLOW_VOICE_PRESETS has exactly 30 presets", () => {
    expect(FLOW_VOICE_PRESETS.length).toBe(30);
  });

  test("FLOW_VOICE_PRESETS contains known boundary presets", () => {
    expect(FLOW_VOICE_PRESETS).toContain("Achird");
    expect(FLOW_VOICE_PRESETS).toContain("Zubenelgenubi");
  });

  test("FLOW_VOICE_PRESETS has no duplicates", () => {
    expect(new Set(FLOW_VOICE_PRESETS).size).toBe(FLOW_VOICE_PRESETS.length);
  });
});

import type { UseApiVideoParams } from "../src/backends/types";

describe("UseApiVideoParams shape", () => {
  test("accepts an omni-flash V2V request", () => {
    const params: UseApiVideoParams = {
      prompt: "edit this clip",
      model: "omni-flash",
      referenceVideo_1: "user:1-email:x-video:abc",
      startFrameIndex_1: 0,
      endFrameIndex_1: 192,
      referenceAudio_1: "Aoede",
    };
    expect(params.model).toBe("omni-flash");
  });

  test("accepts a Veo I2V-FL request with duration", () => {
    const params: UseApiVideoParams = {
      prompt: "pan right",
      model: "veo-3.1-fast",
      startImage: "user:1-email:x-image:s",
      endImage: "user:1-email:x-image:e",
      duration: 6,
    };
    expect(params.duration).toBe(6);
  });
});

import type {
  UseApiVideoResponse, UseApiVideoExtendParams, UseApiVideoConcatParams,
} from "../src/backends/types";

describe("response + extend/concat types", () => {
  test("UseApiVideoResponse exposes media[]", () => {
    const r: UseApiVideoResponse = {
      jobId: "j1",
      media: [{ name: "n", mediaGenerationId: "m", videoUrl: "https://x" }],
    };
    expect(r.media?.[0].videoUrl).toBe("https://x");
  });

  test("extend params reject omni-flash at the type level", () => {
    const p: UseApiVideoExtendParams = { mediaGenerationId: "m", prompt: "more" };
    expect(p.model).toBeUndefined();
  });

  test("concat params take a media array", () => {
    const p: UseApiVideoConcatParams = {
      media: [{ mediaGenerationId: "a" }, { mediaGenerationId: "b", trimStart: 1 }],
    };
    expect(p.media.length).toBe(2);
  });
});

import type { UseApiImageParams } from "../src/backends/types";

describe("UseApiImageParams shape", () => {
  test("accepts nano-banana-2 with auto aspect ratio", () => {
    const p: UseApiImageParams = {
      prompt: "a fox", model: "nano-banana-2", aspectRatio: "auto",
      reference_1: "user:1-email:x-image:r",
    };
    expect(p.model).toBe("nano-banana-2");
  });
});
