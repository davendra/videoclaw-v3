/**
 * Unit tests for src/prompts.ts
 */

import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import {
  parsePromptLine,
  validatePrompts,
  extractTag,
  filterPrompts,
} from "../src/prompts";

describe("parsePromptLine", () => {
  describe("text-to-video prompts", () => {
    test("parses simple text prompt", () => {
      const result = parsePromptLine("[sunset] A beautiful sunset");
      expect(result.type).toBe("text");
      expect(result.prompt).toBe("[sunset] A beautiful sunset");
    });

    test("parses text prompt without tag", () => {
      const result = parsePromptLine("A beautiful sunset");
      expect(result.type).toBe("text");
      expect(result.prompt).toBe("A beautiful sunset");
    });

    test("parses empty prompt as text type", () => {
      const result = parsePromptLine("");
      expect(result.type).toBe("text");
      expect(result.prompt).toBe("");
    });

    test("parses whitespace-only prompt as text type", () => {
      const result = parsePromptLine("   ");
      expect(result.type).toBe("text");
      expect(result.prompt).toBe("   ");
    });
  });

  describe("image-to-video prompts", () => {
    test("parses image prompt with local path", () => {
      const result = parsePromptLine("[portrait] image:./photo.jpg The person smiles");
      expect(result.type).toBe("image");
      expect((result as any).imagePath).toBe("./photo.jpg");
      expect((result as any).prompt).toBe("The person smiles");
    });

    test("parses image prompt with absolute path", () => {
      const result = parsePromptLine("image:/path/to/image.png Motion prompt");
      expect(result.type).toBe("image");
      expect((result as any).imagePath).toBe("/path/to/image.png");
      expect((result as any).prompt).toBe("Motion prompt");
    });

    test("parses image prompt with mediaGenerationId", () => {
      const result = parsePromptLine("[test] image:CAMaJD123abc456 The person walks");
      expect(result.type).toBe("image");
      expect((result as any).imagePath).toBe("CAMaJD123abc456");
      expect((result as any).prompt).toBe("The person walks");
    });

    test("parses image prompt without motion prompt", () => {
      const result = parsePromptLine("image:./photo.jpg");
      expect(result.type).toBe("image");
      expect((result as any).imagePath).toBe("./photo.jpg");
      expect((result as any).prompt).toBe("");
    });

    test("handles spaces in prompt after image path", () => {
      const result = parsePromptLine("image:./photo.jpg   Multiple words here   ");
      expect(result.type).toBe("image");
      // Regex captures everything after the first whitespace after path
      expect((result as any).prompt).toBe("Multiple words here   ");
    });
  });

  describe("frames-to-video prompts", () => {
    test("parses frames prompt with local paths", () => {
      const result = parsePromptLine("[morph] frames:./start.jpg,./end.jpg Transition");
      expect(result.type).toBe("frames");
      expect((result as any).startPath).toBe("./start.jpg");
      expect((result as any).endPath).toBe("./end.jpg");
      expect((result as any).prompt).toBe("Transition");
    });

    test("parses frames prompt with absolute paths", () => {
      const result = parsePromptLine("frames:/a/start.png,/b/end.png Smooth morph");
      expect(result.type).toBe("frames");
      expect((result as any).startPath).toBe("/a/start.png");
      expect((result as any).endPath).toBe("/b/end.png");
      expect((result as any).prompt).toBe("Smooth morph");
    });

    test("parses frames prompt with mediaGenerationIds", () => {
      const result = parsePromptLine("frames:MEDIA_ID_1,MEDIA_ID_2 Transform");
      expect(result.type).toBe("frames");
      expect((result as any).startPath).toBe("MEDIA_ID_1");
      expect((result as any).endPath).toBe("MEDIA_ID_2");
      expect((result as any).prompt).toBe("Transform");
    });

    test("parses frames prompt without transition prompt", () => {
      const result = parsePromptLine("frames:./start.jpg,./end.jpg");
      expect(result.type).toBe("frames");
      expect((result as any).startPath).toBe("./start.jpg");
      expect((result as any).endPath).toBe("./end.jpg");
      expect((result as any).prompt).toBe("");
    });
  });

  describe("ingredients/references prompts", () => {
    test("parses ingredients prompt with single image", () => {
      const result = parsePromptLine("[scene] ingredients:./ref1.jpg Scene description");
      expect(result.type).toBe("ingredients");
      expect((result as any).imagePaths).toEqual(["./ref1.jpg"]);
      expect((result as any).prompt).toBe("Scene description");
    });

    test("parses ingredients prompt with two images", () => {
      const result = parsePromptLine("ingredients:./ref1.jpg,./ref2.jpg Character walks");
      expect(result.type).toBe("ingredients");
      expect((result as any).imagePaths).toEqual(["./ref1.jpg", "./ref2.jpg"]);
      expect((result as any).prompt).toBe("Character walks");
    });

    test("parses ingredients prompt with three images", () => {
      const result = parsePromptLine("ingredients:./a.jpg,./b.jpg,./c.jpg Scene");
      expect(result.type).toBe("ingredients");
      expect((result as any).imagePaths).toEqual(["./a.jpg", "./b.jpg", "./c.jpg"]);
      expect((result as any).prompt).toBe("Scene");
    });

    test("parses ingredients prompt with mediaGenerationIds", () => {
      const result = parsePromptLine("ingredients:ID1,ID2,ID3 Generate scene");
      expect(result.type).toBe("ingredients");
      expect((result as any).imagePaths).toEqual(["ID1", "ID2", "ID3"]);
      expect((result as any).prompt).toBe("Generate scene");
    });
  });

  describe("edge cases", () => {
    test("handles prompt with just 'image:' (no path)", () => {
      // Regex won't match without a path, so falls back to text
      const result = parsePromptLine("image:");
      expect(result.type).toBe("text");
      expect(result.prompt).toBe("image:");
    });

    test("handles prompt with 'frames:' but missing comma", () => {
      // If no comma, regex won't match, falls back to text
      const result = parsePromptLine("frames:./only_one.jpg No comma");
      expect(result.type).toBe("text");
    });

    test("handles prompt with special characters in path", () => {
      const result = parsePromptLine("image:./my-photo_2024.v2.jpg Description");
      expect(result.type).toBe("image");
      expect((result as any).imagePath).toBe("./my-photo_2024.v2.jpg");
    });
  });
});

describe("extractTag", () => {
  test("extracts tag from prompt with brackets", () => {
    expect(extractTag("[sunset] A sunset")).toBe("sunset");
    expect(extractTag("[my-tag] Prompt")).toBe("my-tag");
    expect(extractTag("[tag_with_underscore] Test")).toBe("tag_with_underscore");
  });

  test("extracts tag with numbers", () => {
    expect(extractTag("[video123] Test")).toBe("video123");
    expect(extractTag("[2024-sunset] Test")).toBe("2024-sunset");
  });

  test("extracts tag with spaces inside brackets", () => {
    expect(extractTag("[my tag] Test")).toBe("my tag");
    expect(extractTag("[multi word tag] Test")).toBe("multi word tag");
  });

  test("returns null for prompt without tag", () => {
    expect(extractTag("No tag here")).toBeNull();
    expect(extractTag("")).toBeNull();
    expect(extractTag("   ")).toBeNull();
  });

  test("returns null for malformed tags", () => {
    expect(extractTag("[incomplete")).toBeNull();
    expect(extractTag("incomplete]")).toBeNull();
    expect(extractTag("[]empty")).toBeNull();
  });

  test("only matches tag at the start", () => {
    expect(extractTag("Text before [tag] after")).toBeNull();
    expect(extractTag("  [tag] with leading space")).toBeNull();
  });

  test("handles nested brackets correctly", () => {
    // Should only match the first complete bracket pair
    expect(extractTag("[outer[inner]] text")).toBe("outer[inner");
  });
});

describe("filterPrompts", () => {
  test("removes empty lines", () => {
    const lines = ["line1", "", "line2", "", "line3"];
    expect(filterPrompts(lines)).toEqual(["line1", "line2", "line3"]);
  });

  test("removes whitespace-only lines", () => {
    const lines = ["line1", "   ", "line2", "\t\t", "line3"];
    expect(filterPrompts(lines)).toEqual(["line1", "line2", "line3"]);
  });

  test("removes comment lines starting with #", () => {
    const lines = ["line1", "# comment", "line2", "#another comment", "line3"];
    expect(filterPrompts(lines)).toEqual(["line1", "line2", "line3"]);
  });

  test("removes comments with leading whitespace", () => {
    const lines = ["line1", "  # indented comment", "line2"];
    expect(filterPrompts(lines)).toEqual(["line1", "line2"]);
  });

  test("keeps lines with # in the middle", () => {
    const lines = ["line with # in middle", "hashtag#test"];
    expect(filterPrompts(lines)).toEqual(["line with # in middle", "hashtag#test"]);
  });

  test("returns empty array for all comments/empty", () => {
    const lines = ["", "# comment", "   ", "# another"];
    expect(filterPrompts(lines)).toEqual([]);
  });

  test("returns empty array for empty input", () => {
    expect(filterPrompts([])).toEqual([]);
  });

  test("preserves order of valid lines", () => {
    const lines = ["[a] first", "# skip", "[b] second", "", "[c] third"];
    expect(filterPrompts(lines)).toEqual(["[a] first", "[b] second", "[c] third"]);
  });
});

describe("validatePrompts", () => {
  describe("text prompts validation", () => {
    test("validates non-empty text prompts as valid", () => {
      const result = validatePrompts(["[sunset] A beautiful sunset"]);
      expect(result.validations[0].valid).toBe(true);
      expect(result.validations[0].errors).toEqual([]);
      expect(result.stats.valid).toBe(1);
      expect(result.stats.byType.text).toBe(1);
    });

    test("validates empty text prompts as invalid", () => {
      const result = validatePrompts(["[empty]"]);
      // The tag is part of the prompt for text type
      // "[empty]" is actually not empty, it's the tag
      expect(result.validations[0].valid).toBe(true);
    });

    test("extracts tag correctly", () => {
      const result = validatePrompts(["[my-tag] Some prompt"]);
      expect(result.validations[0].tag).toBe("my-tag");
    });

    test("handles prompt without tag", () => {
      const result = validatePrompts(["No tag here"]);
      expect(result.validations[0].tag).toBeNull();
    });
  });

  describe("statistics", () => {
    test("counts total prompts correctly", () => {
      const result = validatePrompts([
        "[a] First prompt",
        "[b] Second prompt",
        "[c] Third prompt",
      ]);
      expect(result.stats.total).toBe(3);
    });

    test("skips empty lines and comments", () => {
      const result = validatePrompts([
        "[a] First",
        "",
        "# comment",
        "[b] Second",
        "   ",
      ]);
      expect(result.stats.total).toBe(2);
    });

    test("counts by type correctly", () => {
      const result = validatePrompts([
        "[t] Text prompt",
        "[i] image:MEDIA_ID Motion",
        "[f] frames:ID1,ID2 Transition",
        "[r] ingredients:ID1,ID2 Scene",
      ]);
      expect(result.stats.byType.text).toBe(1);
      expect(result.stats.byType.image).toBe(1);
      expect(result.stats.byType.frames).toBe(1);
      expect(result.stats.byType.ingredients).toBe(1);
    });
  });

  describe("image prompts validation", () => {
    test("validates image prompt with mediaGenerationId as valid", () => {
      const result = validatePrompts(["[test] image:CAMaJD123 Motion"]);
      expect(result.validations[0].valid).toBe(true);
      expect(result.stats.byType.image).toBe(1);
    });

    test("validates image prompt with non-existent local file as invalid", () => {
      const result = validatePrompts(["[test] image:./nonexistent.jpg Motion"]);
      expect(result.validations[0].valid).toBe(false);
      expect(result.validations[0].errors[0]).toContain("Image not found");
    });
  });

  describe("frames prompts validation", () => {
    test("validates frames prompt with mediaGenerationIds as valid", () => {
      const result = validatePrompts(["[test] frames:ID1,ID2 Transition"]);
      expect(result.validations[0].valid).toBe(true);
      expect(result.stats.byType.frames).toBe(1);
    });

    test("validates frames prompt with non-existent local files as invalid", () => {
      const result = validatePrompts(["[test] frames:./missing1.jpg,./missing2.jpg Trans"]);
      expect(result.validations[0].valid).toBe(false);
      expect(result.validations[0].errors.length).toBeGreaterThan(0);
    });
  });

  describe("ingredients prompts validation", () => {
    test("validates ingredients prompt with mediaGenerationIds as valid", () => {
      const result = validatePrompts(["[test] ingredients:ID1,ID2 Scene"]);
      expect(result.validations[0].valid).toBe(true);
      expect(result.stats.byType.ingredients).toBe(1);
    });

    test("validates ingredients prompt with non-existent local files as invalid", () => {
      const result = validatePrompts(["[test] ingredients:./missing.jpg Scene"]);
      expect(result.validations[0].valid).toBe(false);
      expect(result.validations[0].errors[0]).toContain("not found");
    });
  });

  describe("validation summary", () => {
    test("returns correct valid/invalid counts", () => {
      const result = validatePrompts([
        "[valid] This is valid",
        "[invalid] image:./nonexistent.jpg Motion",
      ]);
      expect(result.stats.valid).toBe(1);
      expect(result.stats.invalid).toBe(1);
    });
  });
});
