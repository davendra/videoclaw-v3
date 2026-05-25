import { describe, test, expect } from "bun:test";
import { transformVideoResponse } from "../src/backends/useapi/index";

describe("transformVideoResponse", () => {
  test("reads videoUrl from the media[] (200 sync) shape", () => {
    const out = transformVideoResponse({
      jobId: "j1",
      media: [{ name: "n", mediaGenerationId: "m", videoUrl: "https://cdn/v.mp4",
                thumbnailUrl: "https://cdn/t.jpg" }],
    });
    expect(out[0].videoUrl).toBe("https://cdn/v.mp4");
  });

  test("falls back to operations[].fifeUrl (legacy/async shape)", () => {
    const out = transformVideoResponse({
      jobId: "j2",
      operations: [{
        operation: { name: "op", metadata: { video: { fifeUrl: "https://cdn/legacy.mp4" } } },
        status: "MEDIA_GENERATION_STATUS_SUCCESSFUL",
      }],
    });
    expect(out[0].videoUrl).toBe("https://cdn/legacy.mp4");
  });
});
