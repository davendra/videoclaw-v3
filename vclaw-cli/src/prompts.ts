/**
 * Prompt parsing and validation module for veo-cli
 */

import { join } from "path";
import { existsSync } from "fs";
import type { ParsedPrompt } from "./types";

/**
 * Parse a single prompt line into its type and components
 */
export function parsePromptLine(line: string): ParsedPrompt {
  // Format: [tag] image:./path.png Optional motion prompt
  if (line.includes("image:")) {
    const match = line.match(/image:(\S+)\s*(.*)/);
    if (match) {
      const [, imagePath, prompt = ""] = match;
      return {
        type: "image",
        imagePath,
        prompt,
      };
    }
  }

  // Format: [tag] frames:./start.png,./end.png Optional transition prompt
  if (line.includes("frames:")) {
    const match = line.match(/frames:(\S+),(\S+)\s*(.*)/);
    if (match) {
      const [, startPath, endPath, prompt = ""] = match;
      return {
        type: "frames",
        startPath,
        endPath,
        prompt,
      };
    }
  }

  // Format: [tag] ingredients:./img1.png,./img2.png,./img3.png Scene prompt
  if (line.includes("ingredients:")) {
    const match = line.match(/ingredients:(\S+)\s+(.*)/);
    if (match) {
      const [, rawImagePaths, prompt = ""] = match;
      const imagePaths = rawImagePaths.split(",");
      return {
        type: "ingredients",
        imagePaths,
        prompt,
      };
    }
  }

  // Default: text-to-video
  return { type: "text", prompt: line };
}

/**
 * Validation result for a single prompt
 */
export type PromptValidation = {
  line: string;
  parsed: ParsedPrompt;
  tag: string | null;
  valid: boolean;
  errors: string[];
};

/**
 * Validation statistics
 */
export type ValidationStats = {
  total: number;
  valid: number;
  invalid: number;
  byType: Record<string, number>;
};

/**
 * Helper to check if a path looks like a local file
 */
function isLocalPath(p: string): boolean {
  return p.startsWith("./") || p.startsWith("/") || p.includes("/");
}

/**
 * Validate all prompts and return statistics
 */
export function validatePrompts(prompts: string[]): {
  validations: PromptValidation[];
  stats: ValidationStats;
} {
  const validations: PromptValidation[] = [];
  const byType: Record<string, number> = {
    text: 0,
    image: 0,
    frames: 0,
    ingredients: 0,
  };

  for (const line of prompts) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const parsed = parsePromptLine(line);
    const tagMatch = line.match(/^\[([^\]]+)\]/);
    const tag = tagMatch?.[1] ?? null;
    const errors: string[] = [];

    // Validate based on type
    switch (parsed.type) {
      case "image": {
        if (!parsed.imagePath) {
          errors.push("Missing image path");
        } else if (isLocalPath(parsed.imagePath)) {
          // Local file path - check if exists
          const fullPath = parsed.imagePath.startsWith("/")
            ? parsed.imagePath
            : join(process.cwd(), parsed.imagePath);
          if (!existsSync(fullPath)) {
            errors.push(`Image not found: ${parsed.imagePath}`);
          }
        }
        // If it's a mediaGenerationId, we can't validate it without API call
        break;
      }
      case "frames": {
        if (!parsed.startPath || !parsed.endPath) {
          errors.push("Missing start or end frame path");
        } else {
          // Check start frame
          if (isLocalPath(parsed.startPath)) {
            const fullPath = parsed.startPath.startsWith("/")
              ? parsed.startPath
              : join(process.cwd(), parsed.startPath);
            if (!existsSync(fullPath)) {
              errors.push(`Start frame not found: ${parsed.startPath}`);
            }
          }
          // Check end frame
          if (isLocalPath(parsed.endPath)) {
            const fullPath = parsed.endPath.startsWith("/")
              ? parsed.endPath
              : join(process.cwd(), parsed.endPath);
            if (!existsSync(fullPath)) {
              errors.push(`End frame not found: ${parsed.endPath}`);
            }
          }
        }
        break;
      }
      case "ingredients": {
        if (!parsed.imagePaths || parsed.imagePaths.length === 0) {
          errors.push("Missing ingredient images");
        } else {
          for (const imgPath of parsed.imagePaths) {
            if (isLocalPath(imgPath)) {
              const fullPath = imgPath.startsWith("/")
                ? imgPath
                : join(process.cwd(), imgPath);
              if (!existsSync(fullPath)) {
                errors.push(`Ingredient image not found: ${imgPath}`);
              }
            }
          }
        }
        break;
      }
      case "text":
        // Text prompts are always valid if not empty
        if (!parsed.prompt.trim()) {
          errors.push("Empty prompt");
        }
        break;
    }

    byType[parsed.type] = (byType[parsed.type] ?? 0) + 1;
    validations.push({
      line,
      parsed,
      tag,
      valid: errors.length === 0,
      errors,
    });
  }

  const valid = validations.filter((v) => v.valid).length;

  return {
    validations,
    stats: {
      total: validations.length,
      valid,
      invalid: validations.length - valid,
      byType,
    },
  };
}

/**
 * Extract tag from a prompt line
 */
export function extractTag(line: string): string | null {
  const match = line.match(/^\[([^\]]+)\]/);
  return match?.[1] ?? null;
}

/**
 * Filter prompts: remove empty lines and comments
 */
export function filterPrompts(lines: string[]): string[] {
  return lines.filter(
    (line) => line.trim() && !line.trim().startsWith("#")
  );
}
