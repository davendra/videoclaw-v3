import { describe, test, expect } from "bun:test";
import { mapModelToUseApi, mapAspectRatioToUseApi } from "../src/backends/useapi/client";

describe("mapModelToUseApi", () => {
  test("quality / fast", () => {
    expect(mapModelToUseApi("quality")).toBe("veo-3.1-quality");
    expect(mapModelToUseApi("fast")).toBe("veo-3.1-fast");
  });
  test("lite is a new tier", () => {
    expect(mapModelToUseApi("lite")).toBe("veo-3.1-lite");
  });
  test("free and relaxed map to lite-low-priority (fast-relaxed is gone)", () => {
    expect(mapModelToUseApi("free")).toBe("veo-3.1-lite-low-priority");
    expect(mapModelToUseApi("relaxed")).toBe("veo-3.1-lite-low-priority");
  });
  test("omni / omni-flash map to omni-flash", () => {
    expect(mapModelToUseApi("omni")).toBe("omni-flash");
    expect(mapModelToUseApi("omni-flash")).toBe("omni-flash");
  });
  test("already-qualified identifiers pass through", () => {
    expect(mapModelToUseApi("veo-3.1-lite")).toBe("veo-3.1-lite");
    expect(mapModelToUseApi("omni-flash")).toBe("omni-flash");
  });
  test("unknown value falls back to veo-3.1-fast", () => {
    expect(mapModelToUseApi("nonsense")).toBe("veo-3.1-fast");
  });
});

describe("mapAspectRatioToUseApi", () => {
  test("portrait variants", () => {
    expect(mapAspectRatioToUseApi("9:16")).toBe("portrait");
    expect(mapAspectRatioToUseApi("portrait")).toBe("portrait");
  });
  test("extra Veo ratios pass through", () => {
    expect(mapAspectRatioToUseApi("1:1")).toBe("1:1");
    expect(mapAspectRatioToUseApi("4:3")).toBe("4:3");
    expect(mapAspectRatioToUseApi("3:4")).toBe("3:4");
  });
  test("default is landscape", () => {
    expect(mapAspectRatioToUseApi("16:9")).toBe("landscape");
  });
});
