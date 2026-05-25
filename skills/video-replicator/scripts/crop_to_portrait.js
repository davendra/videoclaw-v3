#!/usr/bin/env node
/**
 * Convert any image to portrait (9:16) aspect ratio using sharp.
 *
 * Usage:
 *   node crop_to_portrait.js input.jpg output.jpg [--width 504] [--height 896]
 *
 * Default target dimensions: 504x896 (9:16 ratio)
 *
 * Features:
 * - Landscape images: center-crop to portrait ratio, then resize to 504x896
 * - Portrait images: resize to exactly 504x896 (maintains aspect with crop if needed)
 * - Square images: crop to portrait ratio, then resize
 * - Preserves image quality
 */

const path = require("path");

// Try to load sharp from multiple locations
let sharp;
try {
  sharp = require("sharp");
} catch (e1) {
  // Try loading from veo-cli's node_modules
  const veoCLIPath = path.resolve(__dirname, "../../../../../veo-cli/node_modules/sharp");
  try {
    sharp = require(veoCLIPath);
  } catch (e2) {
    console.error("Error: sharp module not found.");
    console.error("Install with: npm install sharp");
    console.error("Or run from veo-cli directory: cd ../../../../../veo-cli && node ..");
    process.exit(1);
  }
}

// Standard portrait dimensions (matches tested crop from scene_4_frame.jpg)
const DEFAULT_WIDTH = 504;
const DEFAULT_HEIGHT = 896;
const PORTRAIT_RATIO = 9 / 16; // 0.5625

async function cropToPortrait(inputPath, outputPath, targetWidth, targetHeight) {
  try {
    // Get input image metadata
    const metadata = await sharp(inputPath).metadata();
    const { width, height } = metadata;

    if (!width || !height) {
      console.error(`Error: Could not read dimensions from ${inputPath}`);
      process.exit(1);
    }

    const currentRatio = width / height;

    // Check if already exact target dimensions
    if (width === targetWidth && height === targetHeight) {
      console.log(`Image is already ${targetWidth}x${targetHeight}, copying to output.`);
      await sharp(inputPath).toFile(outputPath);
      console.log(`Output: ${outputPath}`);
      return;
    }

    // Calculate crop dimensions
    // For portrait: keep full height, crop width from center
    const targetRatio = targetWidth / targetHeight;
    let cropWidth, cropHeight, cropLeft, cropTop;

    if (currentRatio > targetRatio) {
      // Image is wider than target ratio - crop width
      cropHeight = height;
      cropWidth = Math.round(height * targetRatio);
      cropLeft = Math.round((width - cropWidth) / 2);
      cropTop = 0;
    } else {
      // Image is taller than target ratio - crop height
      cropWidth = width;
      cropHeight = Math.round(width / targetRatio);
      cropTop = Math.round((height - cropHeight) / 2);
      cropLeft = 0;
    }

    console.log(`Input: ${inputPath}`);
    console.log(`  Original: ${width}x${height} (ratio ${currentRatio.toFixed(3)})`);
    console.log(`  Target: ${targetWidth}x${targetHeight} (ratio ${targetRatio.toFixed(3)})`);
    console.log(`  Crop region: left=${cropLeft}, top=${cropTop}, width=${cropWidth}, height=${cropHeight}`);

    // Perform crop and optional resize to exact target dimensions
    let pipeline = sharp(inputPath).extract({
      left: cropLeft,
      top: cropTop,
      width: cropWidth,
      height: cropHeight,
    });

    // If cropped size doesn't match target, resize to exact dimensions
    if (cropWidth !== targetWidth || cropHeight !== targetHeight) {
      pipeline = pipeline.resize(targetWidth, targetHeight, {
        fit: "fill",
      });
    }

    await pipeline.toFile(outputPath);

    // Verify output
    const outputMeta = await sharp(outputPath).metadata();
    console.log(`  Output: ${outputPath} (${outputMeta.width}x${outputMeta.height})`);
    console.log(`Crop successful`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(`Usage: node crop_to_portrait.js <input> <output> [--width N] [--height N]`);
    console.log(`\nOptions:`);
    console.log(`  --width N   Target width (default: ${DEFAULT_WIDTH})`);
    console.log(`  --height N  Target height (default: ${DEFAULT_HEIGHT})`);
    console.log(`\nExample:`);
    console.log(`  node crop_to_portrait.js landscape.jpg portrait.jpg`);
    console.log(`  node crop_to_portrait.js photo.png cropped.png --width 504 --height 896`);
    process.exit(1);
  }

  let inputPath = args[0];
  let outputPath = args[1];
  let targetWidth = DEFAULT_WIDTH;
  let targetHeight = DEFAULT_HEIGHT;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--width" && args[i + 1]) {
      targetWidth = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--height" && args[i + 1]) {
      targetHeight = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { inputPath, outputPath, targetWidth, targetHeight };
}

// Main
const { inputPath, outputPath, targetWidth, targetHeight } = parseArgs();
cropToPortrait(inputPath, outputPath, targetWidth, targetHeight);
