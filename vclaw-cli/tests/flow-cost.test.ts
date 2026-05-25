import { describe, test, expect } from "bun:test";
import { calculateCost, calculateImageCost } from "../src/backends/useapi/client";

describe("calculateCost (credits)", () => {
  test("veo-3.1-fast 8s = 20 credits/video", () => {
    expect(calculateCost("veo-3.1-fast", 1).credits).toBe(20);
  });
  test("veo-3.1-quality = 100 credits/video", () => {
    expect(calculateCost("veo-3.1-quality", 2).credits).toBe(200);
  });
  test("veo-3.1-lite-low-priority = 0 credits", () => {
    expect(calculateCost("veo-3.1-lite-low-priority", 3).credits).toBe(0);
  });
  test("omni-flash cost scales with duration", () => {
    expect(calculateCost("omni-flash", 1, 4).credits).toBe(15);
    expect(calculateCost("omni-flash", 1, 6).credits).toBe(20);
    expect(calculateCost("omni-flash", 1, 8).credits).toBe(25);
    expect(calculateCost("omni-flash", 1, 10).credits).toBe(30);
  });
});

describe("calculateImageCost", () => {
  test("nano-banana-2 is a known model", () => {
    expect(calculateImageCost("nano-banana-2", 1).total).toBeGreaterThan(0);
  });
});
