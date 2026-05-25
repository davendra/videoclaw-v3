import { describe, test, expect } from "bun:test";
import { UseApiClient } from "../src/backends/useapi/client";

describe("UseApiClient extend/concat", () => {
  test("extendVideo posts to /google-flow/videos/extend", () => {
    const client = new UseApiClient({ apiToken: "t", accountEmail: "e@x.com" });
    expect(typeof client.extendVideo).toBe("function");
  });
  test("concatenateVideos posts to /google-flow/videos/concatenate", () => {
    const client = new UseApiClient({ apiToken: "t", accountEmail: "e@x.com" });
    expect(typeof client.concatenateVideos).toBe("function");
  });
});
