import { describe, test, expect } from "bun:test";
import { validateFlowVideoRequest } from "../src/backends/useapi/client";
import type { UseApiVideoParams } from "../src/backends/types";

const base: UseApiVideoParams = { prompt: "a scene" };

describe("validateFlowVideoRequest", () => {
  test("a plain T2V request is valid", () => {
    expect(validateFlowVideoRequest(base).ok).toBe(true);
  });

  test("endImage without startImage is rejected", () => {
    const r = validateFlowVideoRequest({ ...base, endImage: "e" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("endImage");
  });

  test("I2V combined with R2V is rejected", () => {
    const r = validateFlowVideoRequest({ ...base, startImage: "s", referenceImage_1: "r" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("I2V");
  });

  test("omni-flash with startImage is rejected", () => {
    const r = validateFlowVideoRequest({ ...base, model: "omni-flash", startImage: "s" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("omni-flash");
  });

  test("referenceVideo_1 on Veo is rejected", () => {
    const r = validateFlowVideoRequest({ ...base, model: "veo-3.1-fast", referenceVideo_1: "v" });
    expect(r.ok).toBe(false);
  });

  test("referenceImage_4 on Veo is rejected", () => {
    const r = validateFlowVideoRequest({ ...base, model: "veo-3.1-fast", referenceImage_4: "r" });
    expect(r.ok).toBe(false);
  });

  test("referenceAudio_2 on Veo is rejected", () => {
    const r = validateFlowVideoRequest({ ...base, model: "veo-3.1-fast", referenceAudio_2: "Kore" });
    expect(r.ok).toBe(false);
  });

  test("R2V on veo-3.1-quality is rejected", () => {
    const r = validateFlowVideoRequest({ ...base, model: "veo-3.1-quality", referenceImage_1: "r" });
    expect(r.ok).toBe(false);
  });

  test("duration 10 on Veo is rejected", () => {
    const r = validateFlowVideoRequest({ ...base, model: "veo-3.1-fast", duration: 10 });
    expect(r.ok).toBe(false);
  });

  test("duration 10 on omni-flash is valid", () => {
    const r = validateFlowVideoRequest({ ...base, model: "omni-flash", duration: 10 });
    expect(r.ok).toBe(true);
  });

  test("veo-3.1-quality with duration 6 is rejected", () => {
    const r = validateFlowVideoRequest({ ...base, model: "veo-3.1-quality", duration: 6 });
    expect(r.ok).toBe(false);
  });

  test("Veo R2V with duration 6 is rejected", () => {
    const r = validateFlowVideoRequest({ ...base, model: "veo-3.1-fast", referenceImage_1: "r", duration: 6 });
    expect(r.ok).toBe(false);
  });

  test("Veo voice without an image reference is rejected", () => {
    const r = validateFlowVideoRequest({ ...base, model: "veo-3.1-fast", referenceAudio_1: "Kore" });
    expect(r.ok).toBe(false);
  });

  test("omni-flash voice without an image or video reference is rejected (live-API parity)", () => {
    // Live API on 2026-05-24 returned: "referenceAudio_1 requires at least one
    // referenceImage_1." — matching this here prevents wasted CAPTCHA spend.
    const r = validateFlowVideoRequest({ ...base, model: "omni-flash", referenceAudio_1: "Kore" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("referenceAudio_*");
  });

  test("omni-flash voice with a referenceImage_1 (R2V) is valid", () => {
    const r = validateFlowVideoRequest({
      ...base, model: "omni-flash", referenceAudio_1: "Kore", referenceImage_1: "img",
    });
    expect(r.ok).toBe(true);
  });

  test("omni-flash high voice slot (referenceAudio_4) without refs is rejected", () => {
    const r = validateFlowVideoRequest({
      ...base, model: "omni-flash", referenceAudio_4: "Puck",
    });
    expect(r.ok).toBe(false);
  });

  test("duration 4 on Veo produces an Ultra-only warning, not an error", () => {
    const r = validateFlowVideoRequest({ ...base, model: "veo-3.1-fast", duration: 4 });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toContain("Ultra");
  });

  test("count out of range is rejected", () => {
    expect(validateFlowVideoRequest({ ...base, count: 9 }).ok).toBe(false);
  });

  test("a valid omni-flash V2V edit passes", () => {
    const r = validateFlowVideoRequest({
      ...base, model: "omni-flash", referenceVideo_1: "v",
      startFrameIndex_1: 0, endFrameIndex_1: 192, referenceAudio_1: "Puck",
    });
    expect(r.ok).toBe(true);
  });

  test("endFrameIndex not greater than startFrameIndex is rejected", () => {
    const r = validateFlowVideoRequest({
      ...base, model: "omni-flash", referenceVideo_1: "v",
      startFrameIndex_1: 100, endFrameIndex_1: 100,
    });
    expect(r.ok).toBe(false);
  });

  test("omni-flash V2V with an explicit duration is rejected with an actionable message", () => {
    const r = validateFlowVideoRequest({
      ...base, model: "omni-flash", referenceVideo_1: "v", duration: 8,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("endFrameIndex_1");
  });

  test("veo-3.1-lite-low-priority produces an Ultra-only warning, not an error", () => {
    const r = validateFlowVideoRequest({ ...base, model: "veo-3.1-lite-low-priority" });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toContain("Ultra");
  });
});
