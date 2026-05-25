<div align="center">

# 🎬 veo-cli

### Batch AI Video Generation for Google Veo

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-1.3+-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Google Veo](https://img.shields.io/badge/Google-Veo%203.x-4285F4?logo=google)](https://labs.google/fx/tools/flow)

**Automate video creation with Google's Veo 3.x models. Text-to-video, image-to-video, batch processing, and more.**

[Quick Start](#-quick-start) •
[Features](#-features) •
[Documentation](#-documentation) •
[API Reference](./docs/API-REFERENCE.md)

</div>

---

## ✨ Highlights

| Feature | Description |
|---------|-------------|
| 🎥 **Text-to-Video** | Generate videos from text prompts with Veo 3.1 |
| 🖼️ **Image-to-Video** | Animate images with motion prompts |
| 📤 **Direct Upload** | Auto-upload local images (no manual Flow upload needed!) |
| 📦 **Batch Processing** | Process unlimited prompts from a file |
| 📁 **Smart Naming** | Videos saved as `YYYY-MM-DD_HH-MM_tag.mp4` |
| ⚡ **Fast Models** | Support for Veo 3.1 Fast (~60s generation) |
| 🔍 **Dry-Run Mode** | Validate prompts and estimate credits before running |
| 💾 **Resume/Checkpoint** | SQLite-backed job tracking with auto-resume |
| 📊 **CLI Dashboard** | Status, list, history commands for batch management |

---

## 🚀 Quick Start

```bash
# 1. Clone and install
git clone https://github.com/davendra/veo-cli.git
cd veo-cli
./scripts/setup.sh

# 2. Generate a video (single prompt)
bun run google.ts -p "[sunset] Golden sunset over the ocean, cinematic 4K"

# Or use a prompts file for batch processing
nano prompts.txt
./scripts/generate.sh
```

### Example Prompts

```text
[sunset] A breathtaking sunset over the ocean, golden rays, cinematic 4K
[drone] Aerial drone shot flying through a misty mountain valley at dawn
[portrait] image:./photo.jpg The person slowly turns and smiles warmly
```

---

## 📋 Features

### Video Generation Modes

| Mode | Syntax | Description |
|------|--------|-------------|
| **Text-to-Video** | `[tag] prompt` | Generate from text description |
| **Image-to-Video** | `[tag] image:./photo.jpg prompt` | Animate a local image (auto-uploaded) |
| **Frames-to-Video** | `[tag] frames:./start.jpg,./end.jpg prompt` | Transition between two images |
| **References** | `[tag] ingredients:./ref1.jpg,./ref2.jpg prompt` | Use 1-3 reference images |

> **New:** Local image paths are now auto-uploaded to Flow! No need to manually upload and copy mediaGenerationIds.

### Supported Models

| Model | Speed | Audio | Credits |
|-------|-------|-------|---------|
| Veo 3.1 Quality | ~210s | ✅ Beta | 100 |
| Veo 3.1 Fast | ~100s | ✅ Beta | 10 |
| Veo 3.1 Fast (Free) | ~100s | ✅ Beta | Free |
| Veo 2 Quality | ~300s | ❌ | 100 |

### Helper Scripts

| Script | Usage | Description |
|--------|-------|-------------|
| `setup.sh` | `./scripts/setup.sh` | First-time setup |
| `generate.sh` | `./scripts/generate.sh [--headless] [--dry-run]` | Run video generation |
| `download-project.sh` | `./scripts/download-project.sh <id>` | Download from project |

---

## 📦 Installation

### Prerequisites

- [Bun](https://bun.sh) v1.3.5+
- Chrome/Chromium browser
- Google account with [Labs Flow](https://labs.google/fx/tools/flow) access

### Setup

```bash
# Clone repository
git clone https://github.com/davendra/veo-cli.git
cd veo-cli

# Run setup script
./scripts/setup.sh

# Or manual setup:
bun install
cp examples/config.example.json config.json
cp examples/prompts.example.txt prompts.txt
```

---

## ⚙️ Configuration

### Prompts File (`prompts.txt`)

```text
# Text-to-Video
[sunset] A breathtaking sunset over the ocean, cinematic lighting

# Image-to-Video with local file (auto-uploaded!)
[portrait] image:./photo.jpg She slowly turns and smiles

# Or use mediaGenerationId from Flow library
[portrait] image:CAMaJD...full_id... She slowly turns and smiles

# Frames transition with local files
[morph] frames:./start.jpg,./end.jpg Smooth transition between scenes

# Multi-reference with local files
[scene] ingredients:./ref1.jpg,./ref2.jpg Character walks through forest
```

### Config File (`config.json`)

```json
{
  "paths": {
    "prompts": "./prompts.txt",
    "cookies": "./cookie.json",
    "outputDir": "./output-videos"
  },
  "browser": { "headless": true },
  "timing": {
    "pollIntervalMs": 3000,
    "interPromptDelayMs": 30000
  },
  "video": {
    "outputsPerPrompt": 1,
    "isSeedLocked": false
  }
}
```

---

## 🔐 Authentication

### Option 1: Automatic (Recommended)

```bash
bun run google.ts
# Browser opens → Log in → Cookies saved automatically
```

### Option 2: Manual Cookie Export

1. Log into [Google Labs Flow](https://labs.google/fx/tools/flow)
2. Use browser extension (EditThisCookie, Cookie-Editor)
3. Export as JSON → Save as `cookie.json`

---

## 📖 Usage

### Generate Videos

```bash
# Single prompt (no file needed)
bun run google.ts -p "[sunset] Golden sunset over the ocean, cinematic 4K"
bun run google.ts --prompt "[drone] Aerial shot through misty mountains"

# With video options (ratio, model, count, seed)
bun run google.ts -p "[sunset] Golden sunset" -r landscape -m fast
bun run google.ts -p "[tiktok] Dancing cat" -r portrait -m free
bun run google.ts -p "[test] Mountain scene" --seed 12345 --count 2

# Silent video (no audio, uses Veo 2)
bun run google.ts -p "[silent] Timelapse clouds" --no-audio

# With browser window (uses prompts.txt)
bun run google.ts

# Show browser window (for login or debugging)
bun run google.ts --visible

# Dry-run mode (validate prompts, estimate credits)
bun run google.ts --dry-run
bun run google.ts --dry-run -p "[test] My test prompt" -m quality -r portrait

# Custom files
bun run google.ts --prompts ./my-prompts.txt --output ./my-videos
```

### Video Options

| Option | Short | Values | Description |
|--------|-------|--------|-------------|
| `--ratio` | `-r` | `landscape`, `portrait`, `16:9`, `9:16` | Aspect ratio |
| `--model` | `-m` | `quality`, `fast`, `free`, `veo2` | Model/quality tier |
| `--seed` | `-s` | `0-32767` | Seed for reproducibility |
| `--count` | `-n` | `1-4` | Outputs per prompt |
| `--no-audio` | | | Disable audio (uses Veo 2) |
| `--tag` | `-t` | any | Override tag for inline prompt |
| `--quiet` | `-q` | | Suppress non-essential output (for scripting) |

### Dry-Run Mode

Validate your prompts before spending credits:

```bash
$ bun run google.ts --dry-run -p "[sunset] A golden sunset" -r portrait -m fast

=== DRY RUN MODE ===

Prompt source: inline
  "[sunset] A golden sunset"

Video Settings:
  Aspect ratio: portrait (9:16)
  Model: Veo 3.1 Fast (10 credits)
  Outputs per prompt: 1
  Seed: random
  Audio: enabled

Validating 1 prompt(s)...

  ✓ [sunset] A golden sunset
    Type: TEXT

Summary:
  Total prompts: 1
  Valid: 1

Credit Estimation (Veo 3.1):
  T2V: 1 prompt(s) × 1 output(s) × 10 credits = 10
  Total: ~10 credits

✓ All prompts validated. Ready to generate!
```

### CLI Commands

Manage batches and track progress with built-in commands:

```bash
# Show help
bun run google.ts help

# Check current batch status
bun run google.ts status

# List all batches
bun run google.ts list

# Show job history
bun run google.ts history --limit 10

# Resume a specific batch
bun run google.ts resume 42

# Reset failed jobs to retry
bun run google.ts reset

# Cancel current batch
bun run google.ts cancel
```

**Example output:**

```bash
$ bun run google.ts status

=== Batch Status ===
Batch ID: 42
Prompts: ./prompts.txt (5 jobs)
Project: abc123-def456

Progress: ████████░░░░░░░░ 3/5 (60%)

  ✓ [sunset]    completed  2025-01-13_19-30_sunset.mp4
  ✓ [portrait]  completed  2025-01-13_19-32_portrait.mp4
  ✓ [city]      completed  2025-01-13_19-35_city.mp4
  ⏳ [forest]    pending
  ⏳ [ocean]     pending

Run `bun run google.ts` to continue generation.
```

### Download from Project

```bash
# Download all videos from a project
python python/download.py <project-id> -c cookie.json -d ./output-videos

# Download latest 10
python python/download.py <project-id> -c cookie.json -l 10 -o desc
```

### Using Helper Scripts

```bash
./scripts/setup.sh                           # First-time setup
./scripts/generate.sh                        # Generate with browser
./scripts/generate.sh --headless             # Generate headless
./scripts/download-project.sh <project-id>   # Download videos
```

---

## 📁 Project Structure

```
veo-cli/
├── google.ts              # Main automation script
├── src/                   # TypeScript modules
│   ├── cli.ts             # CLI command parser and handlers
│   ├── db.ts              # SQLite database layer
│   ├── types.ts           # TypeScript definitions
│   └── ...                # Other modules (api, auth, config, etc.)
├── scripts/               # Shell scripts
│   ├── setup.sh           # First-time setup
│   ├── generate.sh        # Generation script
│   └── download-project.sh
├── docs/                  # Documentation
│   └── API-REFERENCE.md
├── examples/              # Templates
│   ├── config.example.json
│   └── prompts.example.txt
├── python/                # Python alternative
│   ├── download.py        # Video downloader
│   └── requirements.txt
└── output-videos/         # Output directory
```

---

## 🔧 API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `v1:uploadUserImage` | Upload images for I2V |
| `video:batchAsyncGenerateVideoText` | Text-to-Video |
| `video:batchAsyncGenerateVideoStartImage` | Image-to-Video |
| `video:batchAsyncGenerateVideoFrames` | Frames-to-Video |
| `video:batchAsyncGenerateVideoReferenceImages` | Ingredients/References |
| `video:batchCheckAsyncVideoGenerationStatus` | Poll status |

See [API-REFERENCE.md](./docs/API-REFERENCE.md) for complete documentation.

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| **Cookie file not found** | Run `./scripts/setup.sh` or create `cookie.json` |
| **Not logged in** | Browser opens - log in within 60 seconds |
| **No video model** | Verify access at [labs.google/fx](https://labs.google/fx) |
| **Generation timeout** | Try simpler prompt or wait for lower server load |
| **reCAPTCHA failed** | Run with `--visible` flag to log in |

---

## ⚠️ Limitations

- Requires Google account with Labs Flow access
- Generation time: 1-5 minutes per video
- Rate limits based on account tier
- Cookie sessions may expire
- Supported formats: JPG, PNG, WebP, HEIC, AVIF

---

## 📄 License

MIT © [davendra](https://github.com/davendra)

---

## 🙏 Credits

- [puppeteer-real-browser](https://github.com/AhmedShab/puppeteer-real-browser) - Browser automation
- [Bun](https://bun.sh) - JavaScript runtime
- [Google Veo](https://deepmind.google/technologies/veo/) - AI video models

---

<div align="center">

**[⬆ Back to Top](#-veo-cli)**

</div>
