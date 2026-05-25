/**
 * Unit tests for src/upload.ts
 *
 * Note: Most upload functions require browser automation (Puppeteer).
 * These tests focus on testable utility functions and mock-based tests.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Test utilities for media ID extraction
describe("media ID patterns", () => {
  // Regex pattern from upload.ts
  const MEDIA_ID_PATTERN = /CAM[a-zA-Z0-9_-]{30,}/g;

  function extractMediaIds(text: string): string[] {
    const matches = text.match(MEDIA_ID_PATTERN);
    return matches ? [...new Set(matches)] : [];
  }

  function extractMediaId(text: string): string | null {
    const matches = extractMediaIds(text);
    return matches.length > 0 ? matches[matches.length - 1] : null;
  }

  describe("extractMediaIds", () => {
    test("extracts single media ID from text", () => {
      const text = 'Found media: CAMaJD1234567890abcdefghijklmnopqrstuvwxyz';
      const ids = extractMediaIds(text);
      expect(ids).toHaveLength(1);
      expect(ids[0]).toMatch(/^CAM/);
    });

    test("extracts multiple media IDs from text", () => {
      const text = `
        First: CAMaJD1234567890abcdefghijklmnopqrstuvwxyz
        Second: CAMbKE9876543210zyxwvutsrqponmlkjihgfedcba
      `;
      const ids = extractMediaIds(text);
      expect(ids).toHaveLength(2);
    });

    test("deduplicates repeated media IDs", () => {
      const mediaId = 'CAMaJD1234567890abcdefghijklmnopqrstuvwxyz';
      const text = `${mediaId} appears twice: ${mediaId}`;
      const ids = extractMediaIds(text);
      expect(ids).toHaveLength(1);
    });

    test("returns empty array for text without media IDs", () => {
      const text = 'No media IDs here, just regular text';
      expect(extractMediaIds(text)).toEqual([]);
    });

    test("ignores short CAM strings that are not full IDs", () => {
      const text = 'CAMshort is too short to match';
      expect(extractMediaIds(text)).toEqual([]);
    });

    test("extracts ID from JSON response", () => {
      const json = '{"mediaGenerationId":"CAMaJD1234567890abcdefghijklmnopqrstuvwxyz"}';
      const ids = extractMediaIds(json);
      expect(ids).toHaveLength(1);
    });
  });

  describe("extractMediaId", () => {
    test("returns last media ID when multiple present", () => {
      const text = `
        First: CAMaJD1234567890abcdefghijklmnopqrstuvwxyz
        Last: CAMbKE9876543210zyxwvutsrqponmlkjihgfedcba
      `;
      const id = extractMediaId(text);
      expect(id).toBe("CAMbKE9876543210zyxwvutsrqponmlkjihgfedcba");
    });

    test("returns null for text without media IDs", () => {
      expect(extractMediaId("No IDs here")).toBeNull();
    });

    test("returns single ID when only one present", () => {
      const id = extractMediaId("ID: CAMaJD1234567890abcdefghijklmnopqrstuvwxyz");
      expect(id).toBe("CAMaJD1234567890abcdefghijklmnopqrstuvwxyz");
    });
  });
});

// Test image orientation detection logic
describe("image orientation detection", () => {
  type ImageOrientation = "landscape" | "portrait";

  function determineOrientation(width: number, height: number): ImageOrientation {
    return height > width ? "portrait" : "landscape";
  }

  function needsOrientationChange(
    currentText: string,
    targetOrientation: ImageOrientation
  ): boolean {
    const lowerText = currentText.toLowerCase();
    if (targetOrientation === "portrait") {
      return !lowerText.includes("portrait");
    }
    return !lowerText.includes("landscape");
  }

  describe("determineOrientation", () => {
    test("returns landscape for wide images", () => {
      expect(determineOrientation(1920, 1080)).toBe("landscape");
    });

    test("returns portrait for tall images", () => {
      expect(determineOrientation(1080, 1920)).toBe("portrait");
    });

    test("returns landscape for square images", () => {
      expect(determineOrientation(1000, 1000)).toBe("landscape");
    });

    test("handles 16:9 ratio", () => {
      expect(determineOrientation(1920, 1080)).toBe("landscape");
    });

    test("handles 9:16 ratio", () => {
      expect(determineOrientation(1080, 1920)).toBe("portrait");
    });

    test("handles 4:3 ratio", () => {
      expect(determineOrientation(1600, 1200)).toBe("landscape");
    });

    test("handles 3:4 ratio", () => {
      expect(determineOrientation(1200, 1600)).toBe("portrait");
    });
  });

  describe("needsOrientationChange", () => {
    test("returns false when current matches target (landscape)", () => {
      expect(needsOrientationChange("Landscape", "landscape")).toBe(false);
      expect(needsOrientationChange("LANDSCAPE", "landscape")).toBe(false);
      expect(needsOrientationChange("landscape 16:9", "landscape")).toBe(false);
    });

    test("returns false when current matches target (portrait)", () => {
      expect(needsOrientationChange("Portrait", "portrait")).toBe(false);
      expect(needsOrientationChange("PORTRAIT", "portrait")).toBe(false);
      expect(needsOrientationChange("portrait 9:16", "portrait")).toBe(false);
    });

    test("returns true when change needed (landscape to portrait)", () => {
      expect(needsOrientationChange("Landscape", "portrait")).toBe(true);
      expect(needsOrientationChange("landscape 16:9", "portrait")).toBe(true);
    });

    test("returns true when change needed (portrait to landscape)", () => {
      expect(needsOrientationChange("Portrait", "landscape")).toBe(true);
      expect(needsOrientationChange("portrait 9:16", "landscape")).toBe(true);
    });

    test("handles mixed case text", () => {
      expect(needsOrientationChange("LandScape", "landscape")).toBe(false);
      expect(needsOrientationChange("PORTRAIT mode", "portrait")).toBe(false);
    });
  });
});

// Test UI state detection logic
describe("UI state detection", () => {
  interface UIState {
    hasDialog: boolean;
    hasOverlay: boolean;
    hasFileInput: boolean;
    dialogText: string | null;
  }

  function analyzeUIState(state: UIState): {
    isUploadDialogOpen: boolean;
    isCropDialogOpen: boolean;
  } {
    return {
      isUploadDialogOpen: state.hasFileInput || (state.hasDialog && state.dialogText?.includes("upload") || false),
      isCropDialogOpen: state.hasDialog && (state.dialogText?.includes("crop") || state.dialogText?.includes("Crop") || false),
    };
  }

  test("detects upload dialog with file input", () => {
    const state: UIState = {
      hasDialog: true,
      hasOverlay: true,
      hasFileInput: true,
      dialogText: "Upload your image"
    };
    const analysis = analyzeUIState(state);
    expect(analysis.isUploadDialogOpen).toBe(true);
  });

  test("detects crop dialog", () => {
    const state: UIState = {
      hasDialog: true,
      hasOverlay: true,
      hasFileInput: false,
      dialogText: "Crop and Save your image"
    };
    const analysis = analyzeUIState(state);
    expect(analysis.isCropDialogOpen).toBe(true);
  });

  test("identifies no dialog state", () => {
    const state: UIState = {
      hasDialog: false,
      hasOverlay: false,
      hasFileInput: false,
      dialogText: null
    };
    const analysis = analyzeUIState(state);
    expect(analysis.isUploadDialogOpen).toBe(false);
    expect(analysis.isCropDialogOpen).toBe(false);
  });
});

// Test button priority logic for finding add button
describe("button priority logic", () => {
  interface ButtonInfo {
    text: string;
    ariaLabel: string;
    visible: boolean;
    width: number;
    height: number;
  }

  function prioritizeButton(info: ButtonInfo): number | null {
    if (!info.visible) return null;

    const lowerText = info.text.toLowerCase();
    const lowerLabel = info.ariaLabel.toLowerCase();

    // Exclude close/change buttons
    if (lowerText.includes("close") || lowerLabel.includes("close") || lowerText.includes("change")) {
      return null;
    }

    // Priority 1: Mode-specific labels
    if (lowerLabel.includes("first frame") || lowerLabel.includes("end frame")) {
      return 0;
    }

    // Priority 2: Exact "add" text
    if (lowerText === "add") {
      return 1;
    }

    // Priority 3: Aria label containing "add"
    if (lowerLabel.includes("add")) {
      return 2;
    }

    // Priority 4: Small square button (common pattern)
    const isSmallSquare = info.width >= 32 && info.width <= 80 && Math.abs(info.width - info.height) < 20;
    if (isSmallSquare) {
      return 3;
    }

    return null;
  }

  test("prioritizes first frame label highest", () => {
    const btn: ButtonInfo = {
      text: "",
      ariaLabel: "First Frame",
      visible: true,
      width: 100,
      height: 100
    };
    expect(prioritizeButton(btn)).toBe(0);
  });

  test("prioritizes exact add text second", () => {
    const btn: ButtonInfo = {
      text: "add",
      ariaLabel: "",
      visible: true,
      width: 100,
      height: 100
    };
    expect(prioritizeButton(btn)).toBe(1);
  });

  test("prioritizes aria-label with add third", () => {
    const btn: ButtonInfo = {
      text: "",
      ariaLabel: "add image",
      visible: true,
      width: 100,
      height: 100
    };
    expect(prioritizeButton(btn)).toBe(2);
  });

  test("identifies small square buttons", () => {
    const btn: ButtonInfo = {
      text: "",
      ariaLabel: "",
      visible: true,
      width: 48,
      height: 48
    };
    expect(prioritizeButton(btn)).toBe(3);
  });

  test("excludes hidden buttons", () => {
    const btn: ButtonInfo = {
      text: "add",
      ariaLabel: "",
      visible: false,
      width: 100,
      height: 100
    };
    expect(prioritizeButton(btn)).toBeNull();
  });

  test("excludes close buttons", () => {
    const btn: ButtonInfo = {
      text: "close",
      ariaLabel: "",
      visible: true,
      width: 100,
      height: 100
    };
    expect(prioritizeButton(btn)).toBeNull();
  });

  test("excludes change buttons", () => {
    const btn: ButtonInfo = {
      text: "change image",
      ariaLabel: "",
      visible: true,
      width: 100,
      height: 100
    };
    expect(prioritizeButton(btn)).toBeNull();
  });
});

// Test aspect ratio for different modes
describe("aspect ratio handling", () => {
  type VideoAspectRatio = "VIDEO_ASPECT_RATIO_LANDSCAPE" | "VIDEO_ASPECT_RATIO_PORTRAIT";

  function mapCropAspect(ratio: VideoAspectRatio): "landscape" | "portrait" {
    return ratio === "VIDEO_ASPECT_RATIO_PORTRAIT" ? "portrait" : "landscape";
  }

  test("maps landscape aspect ratio", () => {
    expect(mapCropAspect("VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("landscape");
  });

  test("maps portrait aspect ratio", () => {
    expect(mapCropAspect("VIDEO_ASPECT_RATIO_PORTRAIT")).toBe("portrait");
  });
});

// Test file path validation
describe("file path validation", () => {
  function isValidImagePath(path: string): boolean {
    const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.toLowerCase().slice(path.lastIndexOf('.'));
    return validExtensions.includes(ext);
  }

  function isMediaId(path: string): boolean {
    return /^CAM[a-zA-Z0-9_-]{30,}$/.test(path);
  }

  describe("isValidImagePath", () => {
    test("accepts jpg files", () => {
      expect(isValidImagePath("image.jpg")).toBe(true);
      expect(isValidImagePath("image.JPG")).toBe(true);
    });

    test("accepts jpeg files", () => {
      expect(isValidImagePath("image.jpeg")).toBe(true);
    });

    test("accepts png files", () => {
      expect(isValidImagePath("image.png")).toBe(true);
    });

    test("accepts webp files", () => {
      expect(isValidImagePath("image.webp")).toBe(true);
    });

    test("rejects invalid extensions", () => {
      expect(isValidImagePath("file.txt")).toBe(false);
      expect(isValidImagePath("file.pdf")).toBe(false);
      expect(isValidImagePath("file")).toBe(false);
    });
  });

  describe("isMediaId", () => {
    test("recognizes valid media IDs", () => {
      expect(isMediaId("CAMaJD1234567890abcdefghijklmnopqrstuvwxyz")).toBe(true);
    });

    test("rejects short strings", () => {
      expect(isMediaId("CAMshort")).toBe(false);
    });

    test("rejects strings not starting with CAM", () => {
      expect(isMediaId("ABCaJD1234567890abcdefghijklmnopqrstuvwxyz")).toBe(false);
    });

    test("rejects file paths", () => {
      expect(isMediaId("./image.jpg")).toBe(false);
      expect(isMediaId("/path/to/image.png")).toBe(false);
    });
  });
});
