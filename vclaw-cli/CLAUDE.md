# CLAUDE.md

> **As of videoclaw v3.0.0-alpha.0:** The standalone Bun CLI surface
> documented in this file (`bun run flow.ts <verb>`) is being superseded
> by `vclaw veo <verb>` in the main TS CLI. The Bun subprocess is still
> required for Google Flow / Puppeteer access — it's just wrapped now.
>
> **Prefer:** `vclaw veo status`, `vclaw veo list`, `vclaw veo useapi:health`, etc.
>
> **Legacy use:** `bun run flow.ts status` still works for now (no
> deletion in v3.0). Scheduled for soft-deprecation in v3.x and likely
> removal in v4.0.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**veo-cli** is a batch video generation automation tool for [Google Labs Flow](https://labs.google/fx/tools/flow) (Veo 3.x video AI models). It automates the entire workflow: authenticating with Google, managing projects, submitting prompts, waiting for video generation to complete, and downloading the results.

## Recent Changes

- **2026-01-22**: **Comprehensive test suite infrastructure** - Added multi-tier test framework with mocked HTTP responses, fixtures, and shell scripts. Tests cover useapi backend, backend comparison, error handling, and E2E scenarios.
  - New test files: `backend-comparison.test.ts`, `error-handling.test.ts`, `useapi-extended.test.ts`, `useapi-extended.e2e.test.ts`, `useapi-transform.test.ts`
  - New test helpers: `tests/helpers/mock-http.ts` - HTTP mocking for deterministic API tests
  - New fixtures: `tests/fixtures/responses/` - JSON response fixtures for success/error scenarios
  - New shell scripts: `run-all-tests.sh`, `smoke-test.sh`, `test-comprehensive.sh`, `test-useapi-extended.sh`
  - CI/CD: `.github/workflows/tests.yml` for automated test runs

- **2026-01-22**: **useapi.net extended features added** - New CLI commands for image generation (`useapi:image`), image upscaling (`useapi:image:upscale`), video-to-GIF conversion (`useapi:gif` - FREE, no CAPTCHA!), and video upscaling (`useapi:upscale`). Supports Imagen-4, nano-banana, and nano-banana-pro models for image generation.
- **2026-01-22**: **useapi.net backend fully tested** - Fixed API endpoints (image upload: `/google-flow/assets/{email}`, video generation: `/google-flow/videos`), fixed nested mediaGenerationId parsing, verified I2V portrait works via useapi (unlike direct API). Each video uses 1 CAPTCHA credit (~$0.0025).
- **2026-01-21**: Added **useapi.net backend** - Alternative to browser automation via REST API. New `--backend useapi` flag, account management commands (`useapi:accounts`, `useapi:captcha`, `useapi:health`), cost estimation, and job history tracking. Both backends coexist - direct remains default.
- **2026-01-19**: Re-verified I2V portrait API support - Tested `/video:batchAsyncGenerateVideoStartImage` endpoint with portrait aspect ratio. API still returns `INVALID_ARGUMENT`. Landscape enforcement for I2V/Frames modes remains correct. Updated code comments with verification date.
- **2026-01-19**: Fixed R2V (Ingredients-to-Video) mode - Updated model keys from deprecated `veo_3_0_r2v_fast_ultra` to aspect-ratio-specific `veo_3_1_r2v_fast_landscape_ultra`/`veo_3_1_r2v_fast_portrait_ultra`. Fixed paygate tier fallback to TIER_TWO (required for R2V). R2V now works for both landscape and portrait aspect ratios.
- **2026-01-18**: Investigated I2V portrait support. While the Flow UI supports I2V portrait (confirmed working), the direct API returns INVALID_ARGUMENT for portrait aspect ratio. Landscape enforcement remains until API supports portrait.
- **2026-01-16**: Fixed I2V (Image-to-Video) modes - Uses base `veo_3_1_i2v_s` model (no _fast_ultra/_portrait variants). Fixed page reload issue causing mode switch timeouts.
- **2026-01-16**: Auto-detect image orientation for crop dialog - Portrait images now automatically select "Portrait" in the crop dialog dropdown. Uses `image-size` library to detect dimensions before upload.
- **2026-01-14**: Code simplification - removed duplicate functions, added helper functions (`isMediaId()`, `getI2VModelKey()`, `resolveMediaId()`), simplified video model selection. 12% code reduction (206 lines).
- **2026-01-14**: Project reorganization - moved scripts to `scripts/`, docs to `docs/`, examples to `examples/`, Python to `python/`, and `cli.ts`/`db.ts` to `src/`.
- **2026-01-14**: Major cleanup - removed duplicate code from `google.ts`, reduced from 2181 to 716 lines (67% reduction). All functions now imported from `src/` modules.
- **2026-01-14**: Completed modular refactoring - all 11 `src/` modules done (index, types, config, prompts, download, auth, api, upload, generation, cli, db).
- **2026-01-14**: Added `ora` progress spinner showing job progress with elapsed time.
- **2026-01-14**: Added `--quiet` / `-q` flag to suppress non-essential output for scripting.
- **2026-01-14**: Added direct image upload support via `uploadImageViaFlow()` - local image paths in prompts are now auto-uploaded to Flow via puppeteer browser automation. No need to manually upload images and copy mediaGenerationIds.
- **2026-01-14**: Updated image, frames, and ingredients handlers to detect local file paths vs mediaGenerationIds and handle both automatically.
- **2026-01-13**: Made headless mode default, added `--visible` flag for debugging.
- **2026-01-13**: Changed video output to save directly to output dir (no project subfolders).
- **2026-01-13**: Added comprehensive CLI options (`-p`, `-r`, `-m`, `-s`, `-n`, `--no-audio`, `-t`).

Key capabilities:
- Batch process multiple prompts from a text file
- **Direct image upload**: Local file paths are auto-uploaded to Flow (no manual upload needed)
- Support for multiple generation modes:
  - **Text-to-Video (T2V)**: Generate videos from text prompts
  - **Image-to-Video (I2V)**: Generate videos from a single start image (local path or mediaId)
  - **Frames-to-Video (I2V-FL)**: Generate videos from start and end frames (local paths or mediaIds)
  - **Ingredients/References (R2V)**: Generate videos using 1-3 reference images (local paths or mediaIds)
- Automatically select appropriate Veo model based on account tier
- Handle reCAPTCHA tokens transparently (dynamic site key extraction)
- Poll for completion and download videos automatically
- Manage projects and workflows via Google's tRPC API
- Configurable via JSON config file and CLI arguments
- Retry logic for resilient video generation
- **Dry-run mode**: Validate prompts and estimate credits before running
- **Resume/Checkpoint**: SQLite-backed job tracking with auto-resume on interruption
- **CLI Dashboard**: status, list, history, resume, reset, cancel commands

## Backends

veo-cli supports two backends for video generation:

| Backend | Description | Authentication | Best For |
|---------|-------------|----------------|----------|
| `direct` | Browser automation via Puppeteer | `cookie.json` | Full control, debugging, free |
| `useapi` | REST API via useapi.net | API token + account email | Scripting, automation, reliability |

### Backend Selection
```bash
# Use direct backend (default) - browser automation
bun run google.ts -p "[test] Sunset" -m fast

# Use useapi.net backend - REST API
bun run google.ts --backend useapi -p "[test] Sunset" -m fast --yes
```

### useapi.net Backend

The useapi.net backend uses a third-party REST API service instead of browser automation.

**Setup:**
1. Sign up at [useapi.net](https://useapi.net) and get API token
2. Register your Google account with useapi.net
3. Set environment variables:
```bash
export USEAPI_API_TOKEN="user:XXXX-XXXXXXXXXX"
export USEAPI_ACCOUNT_EMAIL="your-email@gmail.com"
```

**Account Management Commands:**
```bash
# List registered accounts
bun run google.ts useapi:accounts list

# Add account using cookies file
bun run google.ts useapi:accounts add --cookies ./google-cookies.txt

# Show account health and CAPTCHA credits
bun run google.ts useapi:health

# List configured CAPTCHA providers
bun run google.ts useapi:captcha list

# Configure CAPTCHA provider
bun run google.ts useapi:captcha --provider ezcaptcha --key YOUR_API_KEY
```

**Model Lineup:**
| CLI value | API model | Notes |
|-----------|-----------|-------|
| `quality` | `veo-3.1-quality` | 8s only, 100 credits |
| `fast`    | `veo-3.1-fast`    | default, 4/6/8s |
| `lite`    | `veo-3.1-lite`    | cheapest Veo tier, 4/6/8s |
| `free`    | `veo-3.1-lite-low-priority` | 0 credits, Ultra $200 only |
| `omni` / `omni-flash` | `omni-flash` | audio-native T2V/R2V/V2V, 4/6/8/10s |

See [GOOGLE-FLOW-V1.md](./docs/GOOGLE-FLOW-V1.md) for the full credit matrix. Video generation costs are now denominated in **credits**, not USD.

**CAPTCHA Credits:**
- Each video generation uses **1 CAPTCHA credit** (~$0.0025)
- New accounts get **100 free credits**
- After free credits: configure a provider (EzCaptcha ~$2.50/1000, CapSolver ~$3.00/1000)

**Total cost per video (fast model):** $0.05 + $0.0025 = **~$0.0525**

**Advantages over direct backend:**
- I2V portrait mode works (direct API returns INVALID_ARGUMENT)
- No browser needed - pure REST API
- More reliable for automation/scripting
- Synchronous response - no polling needed

### useapi.net Extended Features

Additional capabilities beyond video generation:

**Image Generation:**
```bash
# Generate images with Imagen-4 (best for text-to-image)
bun run google.ts useapi:image --image-prompt "A cat in a garden" --image-count 2 -r landscape --yes

# Generate with nano-banana (character consistency, 1-3 refs)
bun run google.ts useapi:image --image-prompt "Portrait of a woman" --image-model nano-banana --ref ./ref1.jpg --yes

# Generate with nano-banana-pro (max refs, upscale-able)
bun run google.ts useapi:image --image-prompt "Product shot" --image-model nano-banana-pro --yes
```

**Image Upscaling (nano-banana-pro only):**
```bash
bun run google.ts useapi:image:upscale --media-id CAMaJD... --resolution 2k
bun run google.ts useapi:image:upscale --media-id CAMaJD... --resolution 4k  # Paid accounts only
```

**Video to GIF (FREE - No CAPTCHA!):**
```bash
bun run google.ts useapi:gif --media-id CAMaJD... --output-file ./preview.gif
```

**Video Upscaling:**
```bash
bun run google.ts useapi:upscale --media-id CAMaJD... --resolution 1080p  # Free
bun run google.ts useapi:upscale --media-id CAMaJD... --resolution 4k --yes  # 50 credits, Ultra tier
```

**Extended Features CLI Options:**
| Flag | Description |
|------|-------------|
| `--image-prompt <text>` | Image generation prompt |
| `--image-count <n>` | Number of images (1-4) |
| `--image-model <model>` | `imagen-4`, `nano-banana`, `nano-banana-pro` |
| `--media-id <id>` | Media ID for upscale/gif operations |
| `--resolution <res>` | `2k`/`4k` (images) or `1080p`/`4k` (videos) |
| `--output-file <path>` | Output file path (for GIF) |
| `--ref <url>` | Reference image (can use multiple times) |

**Extended Features Cost Summary:**
| Feature | Cost | Notes |
|---------|------|-------|
| Image (imagen-4) | ~$0.02 + $0.0025 CAPTCHA | Best for text-to-image |
| Image (nano-banana) | ~$0.03 + $0.0025 CAPTCHA | 1-3 reference images |
| Image (nano-banana-pro) | ~$0.05 + $0.0025 CAPTCHA | 4+ refs, can upscale |
| **Video to GIF** | **FREE** | No CAPTCHA required! |
| Video Upscale 1080p | FREE | Results cached |
| Video Upscale 4K | 50 credits (~$0.25) | Ultra tier, cached |
| Image Upscale 2K | FREE | nano-banana-pro only |
| Image Upscale 4K | Paid accounts | nano-banana-pro only |

**Auto-Model Selection for Images:**
- 0 reference images → `imagen-4`
- 1-3 reference images → `nano-banana`
- 4+ reference images → `nano-banana-pro`

### CAPTCHA Provider Configuration

useapi.net requires CAPTCHA solving for image/video generation. New accounts get **100 free credits**.

**Current Status:**
- Free credits remaining: Check with `bun run google.ts useapi:captcha list`
- When exhausted, configure a provider below

**Supported Providers:**
| Provider | Cost | Recommendation |
|----------|------|----------------|
| EzCaptcha | ~$2.50/1000 | Recommended (highest success rate) |
| CapSolver | ~$3.00/1000 | Good alternative |
| YesCaptcha | varies | Also supported |

**Configure when free credits run out:**

Set your CapSolver key via environment variable — never commit it.

```bash
export CAPSOLVER_API_KEY="your-key-here"
bun run google.ts useapi:captcha --provider capsolver --key "$CAPSOLVER_API_KEY"
```

## Commands

### CLI Subcommands
```bash
bun run google.ts help               # Show all commands
bun run google.ts status             # Show current batch status
bun run google.ts status 42          # Show status of specific batch
bun run google.ts list               # List all batches
bun run google.ts history --limit 10 # Show recent job history
bun run google.ts resume 42          # Resume specific batch
bun run google.ts reset              # Reset failed jobs to pending
bun run google.ts cancel             # Cancel current batch
```

### useapi.net Subcommands
```bash
# Account management
bun run google.ts useapi:accounts list              # List accounts + health
bun run google.ts useapi:accounts add               # Add account (uses cookie.json)
bun run google.ts useapi:accounts add --cookies ./other.json
bun run google.ts useapi:captcha list               # Show CAPTCHA providers + free credits
bun run google.ts useapi:captcha --provider capsolver --key $KEY
bun run google.ts useapi:health                     # Full health check + history

# Extended features (image generation, upscaling, GIF)
bun run google.ts useapi:image --image-prompt "A cat" --yes              # Generate image
bun run google.ts useapi:image:upscale --media-id CAM... --resolution 2k # Upscale image
bun run google.ts useapi:gif --media-id CAM... --output-file ./out.gif   # Video to GIF (FREE!)
bun run google.ts useapi:upscale --media-id CAM... --resolution 1080p    # Upscale video
```

### Generation (TypeScript)
```bash
bun install          # Install dependencies
bun run google.ts    # Run with defaults
bun run google.ts --visible                 # Show browser (for login/debug)
bun run google.ts --dry-run                 # Validate prompts and estimate credits
bun run google.ts --config ./my-config.json # Use custom config
bun run google.ts --prompts ./other.txt     # Custom prompts file
bun run google.ts --cookies ./creds.json    # Custom cookie file
bun run google.ts --output ./output         # Custom output directory

# Video generation options
bun run google.ts -p "[sunset] Golden sunset" -r landscape -m fast
bun run google.ts -p "[tiktok] Dancing cat" -r portrait -m free
bun run google.ts -p "[test] Mountain" --seed 12345 --count 2
bun run google.ts -p "[silent] Timelapse" --no-audio
```

### Video Options
| Flag | Short | Values | Description |
|------|-------|--------|-------------|
| `--ratio` | `-r` | `landscape`, `portrait`, `16:9`, `9:16` | Aspect ratio |
| `--model` | `-m` | `quality`, `fast`, `free`, `veo2` | Model tier |
| `--seed` | `-s` | `0-32767` | Seed for reproducibility |
| `--count` | `-n` | `1-4` | Outputs per prompt |
| `--no-audio` | | | Disable audio (uses Veo 2) |
| `--tag` | `-t` | any | Override tag for inline prompt |
| `--quiet` | `-q` | | Suppress non-essential output (for scripting) |
| `--backend` | | `direct`, `useapi` | Backend selection (default: direct) |
| `--yes` | `-y` | | Skip confirmation prompts (for scripting) |
| `--webhook` | | URL | Webhook for job completion (useapi only) |

### Model Tiers

| CLI value | API model | Notes |
|-----------|-----------|-------|
| `quality` | `veo-3.1-quality` | 8s only, 100 credits |
| `fast`    | `veo-3.1-fast`    | default, 4/6/8s |
| `lite`    | `veo-3.1-lite`    | cheapest Veo tier, 4/6/8s |
| `free`    | `veo-3.1-lite-low-priority` | 0 credits, Ultra $200 only |
| `omni` / `omni-flash` | `omni-flash` | audio-native T2V/R2V/V2V, 4/6/8/10s |

See [GOOGLE-FLOW-V1.md](./docs/GOOGLE-FLOW-V1.md) for the full credit matrix.

### Python (Video downloader)
```bash
pip install -r python/requirements.txt
python python/download.py <project_id> -c cookie.json -d ./output-videos
```

### Test Suite

The test suite includes unit tests (Bun), integration tests, and shell-based E2E tests.

```bash
# Unit tests (Bun test runner)
bun test                                  # Run all unit tests
bun test tests/useapi.test.ts             # Run specific test file
bun test --coverage                       # With coverage report

# Comprehensive test scripts
./tests/run-all-tests.sh                  # Full test suite (unit + E2E)
./tests/smoke-test.sh                     # Quick smoke tests
./tests/test-comprehensive.sh             # Extended coverage tests
./tests/test-useapi-extended.sh           # useapi.net extended features

# Video mode tests (with prompts)
./tests/test-all-modes.sh --dry-run      # Validate prompts only
./tests/test-all-modes.sh --visible      # Full test with browser

# Individual mode tests
./tests/test-t2v.sh --dry-run            # Text-to-Video
./tests/test-r2v.sh --dry-run            # References/Ingredients
./tests/test-i2v.sh --dry-run            # Image-to-Video
./tests/test-f2v.sh --dry-run            # Frames-to-Video

# Quick single test runner
./tests/quick-test.sh                    # Show available tests
./tests/quick-test.sh 1 --dry-run        # Run T2V Landscape
./tests/quick-test.sh r2v --visible      # Run R2V tests with browser
./tests/quick-test.sh all                # Run comprehensive suite
```

### Test Structure

```
tests/
├── *.test.ts             # Unit tests (Bun)
│   ├── useapi.test.ts           # useapi backend core tests
│   ├── useapi-extended.test.ts  # Extended features (image, upscale, GIF)
│   ├── useapi-transform.test.ts # Response transformation tests
│   ├── backend-comparison.test.ts  # Direct vs useapi comparison
│   ├── error-handling.test.ts   # Error scenarios
│   ├── cli.test.ts              # CLI argument parsing
│   ├── db.test.ts               # SQLite operations
│   └── ...
├── helpers/
│   └── mock-http.ts      # HTTP mocking utilities
├── fixtures/
│   └── responses/        # JSON response fixtures
│       ├── image-success.json
│       ├── video-success.json
│       └── ...
└── *.sh                  # Shell-based E2E tests
```

#### Test Images
Tests 3-8 require images in `test-images/`:
- `landscape-test.jpg` - 16:9 landscape image
- `portrait-test.jpg` - 9:16 portrait image

#### Expected Results by Mode

| Mode   | Orientation | Direct Backend | useapi Backend | Notes |
|--------|-------------|----------------|----------------|-------|
| T2V    | Landscape   | ✅ Works | ✅ Works | Full support |
| T2V    | Portrait    | ✅ Works | ✅ Works | Full support |
| R2V    | Landscape   | ✅ Works | ✅ Works | Fixed Jan 19 |
| R2V    | Portrait    | ✅ Works | ✅ Works | Fixed Jan 19 |
| I2V    | Landscape   | ✅ Works | ✅ Works | Full support |
| I2V    | Portrait    | ⚠️ Forces landscape | ✅ Works | useapi supports portrait! |
| Frames | Landscape   | ✅ Works | ✅ Works | Full support |
| Frames | Portrait    | ⚠️ Forces landscape | ✅ Works | useapi supports portrait! |

## Prompt Formats

The `prompts.txt` file supports multiple video generation modes:

### Text-to-Video (Default)
```
[tag] A golden retriever puppy playing in autumn leaves, cinematic lighting
```

### Frames-to-Video (Start Frame Only)
You can use either a local image file path OR a mediaGenerationId:

```
# Using local image file (auto-uploaded via Flow)
[tag] image:./photo.jpg The woman turns and smiles

# Or using mediaGenerationId from Flow library
[tag] image:CAMaJD...full_id... The woman turns and smiles
```

### Frames-to-Video (Start + End Frame)
```
# Using local image files (auto-uploaded)
[tag] frames:./start.jpg,./end.jpg Optional transition prompt

# Or using mediaGenerationIds
[tag] frames:START_MEDIA_ID,END_MEDIA_ID Optional transition prompt
```

### Ingredients/References (1-3 reference images)
```
# Using local image files (auto-uploaded)
[tag] ingredients:./ref1.jpg,./ref2.jpg,./ref3.jpg Scene description prompt

# Or using mediaGenerationIds
[tag] ingredients:MEDIA_ID_1,MEDIA_ID_2,MEDIA_ID_3 Scene description prompt
```

**Note:** Local file paths are automatically uploaded to Flow via the browser. This requires the browser to be running (headless by default).

### Output Naming
Videos are saved with date, time, and tag: `YYYY-MM-DD_HH-MM_tag.mp4`
Example: `2025-01-13_19-30_portrait.mp4`

## Configuration

The application supports a JSON config file (`config.json`) with the following structure:

```json
{
  "paths": {
    "prompts": "./prompts.txt",
    "cookies": "./cookie.json",
    "outputDir": "./output-videos"
  },
  "browser": {
    "headless": true
  },
  "timing": {
    "pollIntervalMs": 3000,
    "maxPollAttempts": 250,
    "requestTimeoutMs": 30000,
    "downloadTimeoutMs": 300000,
    "interPromptDelayMs": 30000,
    "loginWaitMs": 60000
  },
  "video": {
    "outputsPerPrompt": 1,
    "isSeedLocked": false,
    "preferredAspectRatio": null
  }
}
```

Configuration priority: CLI arguments > config file > defaults

## Database

Job state lives in a process-local SQLite file (`veo-cli.db`). This is a
job-cache only — canonical project state is the parent videoclaw CLI's
`projects/<slug>/` JSON layout, written by `native-veo.ts` when it shells
out to this Bun sidecar. No configuration required; the SQLite file is
auto-created on first run.

Cloud-DB support (the prior Convex experiment) was removed at the v3
cutover. v3's deployment story is local-CLI-only; cloud state is out of
scope (see `docs/superpowers/specs/2026-05-25-videoclaw-v3-unification-design.md`).

## Architecture

### Core Components

**google.ts** - Main automation script that:
- Launches a Puppeteer browser with `puppeteer-real-browser` to avoid bot detection
- Authenticates using cookies from `cookie.json`
- Reads prompts from `prompts.txt` and parses the generation mode
- **Direct image upload** via `uploadImageViaFlow()` function:
  - Navigates to Flow project page
  - Switches to "Frames to Video" mode
  - Uploads local image files via FileChooser
  - Handles aspect ratio crop dialog
  - Captures mediaGenerationId from network responses
- Dynamically extracts reCAPTCHA site key (with fallback to known key)
- Gets reCAPTCHA tokens via direct `grecaptcha.enterprise.execute()` call
- Makes API calls to `labs.google/fx/api/trpc` for project/workflow management
- Generates videos via `aisandbox-pa.googleapis.com` API with retry logic
- Supports multiple endpoints:
  - `/video:batchAsyncGenerateVideoText` - Text-to-Video (uses account's default model)
  - `/video:batchAsyncGenerateVideoStartImage` - Image-to-Video (uses `veo_3_1_i2v_s` model)
  - `/video:batchAsyncGenerateVideoFrames` - Frames-to-Video (uses `veo_3_1_i2v_s` model)
  - `/video:batchAsyncGenerateVideoReferenceImages` - Ingredients/References (uses `veo_3_0_r2v_*` models)
- Downloads completed videos to `./output-videos/<projectId>/`

**src/cli.ts** - CLI command parser and handlers:
- Parses subcommands (status, list, resume, reset, history, cancel, help)
- Displays batch progress with progress bars and status icons
- Handles batch management operations

**src/db.ts** - SQLite database layer for job tracking:
- Creates/manages `veo-cli.db` with `batches` and `jobs` tables
- Tracks batch progress across sessions for resume capability
- Functions: `createBatch`, `createJobs`, `getPendingJobs`, `startJob`, `completeJob`, `failJob`

**python/download.py** - Standalone Python script to download videos from an existing project using the workflow API

**examples/config.example.json** - Template for configuration file

### Required Files

- `cookie.json` - Browser cookies for authentication (exported from browser or generated after first login)
- `prompts.txt` - Text file with video prompts (see Prompt Formats above)

### Auto-Generated Files

- `veo-cli.db` - SQLite database for batch/job tracking (auto-created on first run)

### API Flow

1. Parse CLI arguments and check for subcommands (status, list, help, etc.)
2. Load configuration from config.json (if exists) and CLI arguments
3. Check for existing incomplete batch in SQLite; create new batch or resume existing
4. Load cookies and navigate to Google Labs Flow
5. Check login status; if not logged in, wait for manual login (configurable timeout)
6. Fetch or create a project via `project.searchUserProjects` / `project.createProject`
7. Get video model configuration and user settings
8. For each pending job from database:
   - Mark job as running in database
   - Parse the prompt to determine generation mode
   - Get reCAPTCHA token (with retry on failure)
   - For I2V modes with local file paths, auto-upload via `uploadImageViaFlow()`
   - For I2V modes with mediaGenerationIds, use directly
   - Call appropriate video generation endpoint with i2v-specific model (`veo_3_1_i2v_s`)
   - Poll status until complete (handles both success and failure states)
   - Mark job as completed/failed in database
9. Download generated videos from `fifeUrl` with date+time+tag naming
10. Mark batch as completed when all jobs are done

### Key Patterns

- Configuration loaded with defaults -> file config -> CLI override hierarchy
- Cookies are filtered by domain before use (`filterCookiesByUrlDomain`)
- reCAPTCHA site key dynamically extracted from page, with fallback to known key
- Video generation wrapped in retry logic (3 retries with 5s delay)
- Video generation uses a polling loop (configurable interval, max attempts) to check completion status
- Session tokens are extracted from `#__NEXT_DATA__` script element
- Configurable delay between prompts to avoid rate limiting
- Prompt parsing supports multiple generation modes via prefix keywords
- **I2V API Limitation**: Image-to-Video modes (image, frames) only support landscape via the API. The Flow UI supports portrait, but the API returns INVALID_ARGUMENT (verified Jan 19, 2026). The CLI enforces landscape for I2V/Frames modes. **Note**: R2V (ingredients) mode now supports both landscape and portrait (fixed Jan 19, 2026).
- I2V modes always use the base `veo_3_1_i2v_s` model (no `_fast_ultra`, `_relaxed`, or `_portrait` variants like T2V). R2V uses aspect-ratio-specific models (`veo_3_1_r2v_fast_landscape_ultra` / `veo_3_1_r2v_fast_portrait_ultra`).
- Image references use `mediaId` field (not `mediaGenerationId`) in API payloads
- I2V modes support both local file paths (auto-uploaded via puppeteer) and mediaGenerationIds
- Video files are named with timestamp and tag: `YYYY-MM-DD_HH-MM_tag.mp4`
- Progress indicator uses `ora` spinner with elapsed time display (disabled in quiet mode)

## Module Structure

The codebase is organized into modular components in `src/`:

```
src/
├── index.ts          # Re-exports all modules
├── types.ts          # Type definitions (Config, Session, ParsedPrompt, Operation, etc.)
├── config.ts         # Configuration loading, CLI parsing, model mappings
├── prompts.ts        # Prompt parsing and validation
├── download.ts       # Video download with timeout support
├── auth.ts           # reCAPTCHA & authentication
├── api.ts            # HTTP utilities & project API
├── upload.ts         # Image upload via Flow (puppeteer)
├── generation.ts     # Video generation (T2V, I2V, Frames, Ingredients)
├── cli.ts            # CLI command parser and handlers
├── db.ts             # SQLite database layer
└── backends/         # Backend abstraction layer
    ├── index.ts      # VideoBackend interface + createBackend() factory
    ├── types.ts      # Backend-specific types (UseApiConfig, HealthResult, etc.)
    ├── direct/       # Browser automation backend
    │   └── index.ts  # DirectBackend class (wraps existing modules)
    └── useapi/       # useapi.net REST API backend
        ├── index.ts  # UseApiBackend class
        ├── client.ts # HTTP client for useapi.net
        └── accounts.ts # Account management commands
```

**Usage:**
```typescript
import { parsePromptLine, log, download } from "./src";
import { createVideoText, uploadImageViaFlow } from "./src";
```

The main `google.ts` contains the orchestration logic and can import from `src/` modules.
