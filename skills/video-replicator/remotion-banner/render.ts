#!/usr/bin/env npx ts-node
/**
 * CLI script to render CTA banner videos
 *
 * Usage:
 *   npx ts-node render.ts --props props.json --output out/banner.mp4 --composition CTABanner
 *   npx ts-node render.ts --props props.json --output out/banner.webm --codec vp9 --composition CTABannerOverlay
 */

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// ES Module compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RenderOptions {
  props: string;
  output: string;
  composition: string;
  codec?: string;
  transparent?: boolean;
}

async function main() {
  const args = process.argv.slice(2);

  const options: RenderOptions = {
    props: "",
    output: "",
    composition: "CTABanner",
    codec: "h264",
    transparent: false,
  };

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--props":
        options.props = args[++i];
        break;
      case "--output":
        options.output = args[++i];
        break;
      case "--composition":
        options.composition = args[++i];
        break;
      case "--codec":
        options.codec = args[++i];
        break;
      case "--transparent":
        options.transparent = true;
        break;
    }
  }

  if (!options.props || !options.output) {
    console.error("Usage: npx ts-node render.ts --props <props.json> --output <output.mp4> [--composition CTABanner] [--codec h264] [--transparent]");
    process.exit(1);
  }

  // Load props
  const propsPath = path.resolve(options.props);
  if (!fs.existsSync(propsPath)) {
    console.error(`Props file not found: ${propsPath}`);
    process.exit(1);
  }

  const inputProps = JSON.parse(fs.readFileSync(propsPath, "utf-8"));
  console.log("Loaded props:", JSON.stringify(inputProps, null, 2));

  // Bundle the project
  console.log("Bundling Remotion project...");
  const bundleLocation = await bundle({
    entryPoint: path.resolve(__dirname, "src/index.ts"),
    webpackOverride: (config) => config,
  });

  // Get composition
  console.log(`Selecting composition: ${options.composition}`);
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: options.composition,
    inputProps,
  });

  // Ensure output directory exists
  const outputDir = path.dirname(path.resolve(options.output));
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Render
  console.log(`Rendering to: ${options.output}`);

  const codecMap: Record<string, any> = {
    h264: "h264",
    vp8: "vp8",
    vp9: "vp9",
    prores: "prores",
  };

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: codecMap[options.codec || "h264"] || "h264",
    outputLocation: path.resolve(options.output),
    inputProps,
    // For transparency support with VP9/WebM
    ...(options.transparent && options.codec === "vp9"
      ? { pixelFormat: "yuva420p" }
      : {}),
  });

  console.log(`Render complete: ${options.output}`);
}

main().catch((err) => {
  console.error("Render failed:", err);
  process.exit(1);
});
