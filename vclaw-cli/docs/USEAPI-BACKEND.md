# useapi.net Backend Documentation

The useapi.net backend provides an alternative to browser automation for video generation via REST API.

## Overview

| Feature | Direct Backend | useapi.net Backend |
|---------|---------------|-------------------|
| Method | Puppeteer browser automation | REST API calls |
| Authentication | `cookie.json` | API token + account email |
| Setup complexity | Low (just cookies) | Medium (account registration) |
| Reliability | Browser-dependent | High (server-side) |
| Cost | Free (uses your account) | Pay-per-video |
| Debugging | `--visible` flag shows browser | API logs |
| Best for | Development, free usage | Production, automation |

## Setup

### 1. Get useapi.net API Token

1. Sign up at [useapi.net](https://useapi.net)
2. Subscribe to a plan that includes Google Flow access
3. Copy your API token from the dashboard

### 2. Register Google Account

Your Google account needs to be registered with useapi.net to use their service.

**Option A: Via useapi.net Dashboard**
- Use the useapi.net web interface to add your Google account

**Option B: Via CLI (using cookies)**
1. Export cookies from Chrome DevTools:
   - Go to `chrome://settings/cookies`
   - Or: DevTools → Application → Cookies → accounts.google.com
   - Copy all cookies as tab-separated text
2. Save to a file (e.g., `google-cookies.txt`)
3. Run: `bun run google.ts useapi:accounts add --cookies ./google-cookies.txt`

### 3. Set Environment Variables

```bash
# Required
export USEAPI_API_TOKEN="user:XXXX-XXXXXXXXXX"
export USEAPI_ACCOUNT_EMAIL="your-email@gmail.com"

# Optional: CAPTCHA provider (if not using useapi.net free credits)
export EZCAPTCHA_API_KEY="your-ezcaptcha-key"
```

### 4. Verify Setup

```bash
# Check account health
bun run google.ts useapi:health

# Expected output:
# === useapi.net Full Health Check ===
# API Status: ✓ Online
# Account: your-email@gmail.com
#    ├── Tier: unknown
#    └── Health: active
# CAPTCHA Credits: 87 remaining
```

## Usage

### Basic Video Generation

```bash
# Generate video with useapi backend
bun run google.ts --backend useapi -p "[test] A sunset over mountains" -m fast --yes

# Without --yes, you'll see a cost confirmation prompt
bun run google.ts --backend useapi -p "[test] A sunset" -m fast
# Output: Estimated cost: $0.05 (1 video × veo-3.1-fast) + ~$0.003 CAPTCHA
# Proceed? [Y/n]
```

### Dry Run

```bash
# Validate credentials, account, and prompts without generating
bun run google.ts --backend useapi -p "[test] A sunset" --dry-run
```

### With Webhook

```bash
# Get notified when video is ready
bun run google.ts --backend useapi -p "[test] A sunset" --webhook https://myapp.com/hook --yes
```

## CLI Commands

### Account Management

```bash
# List all registered accounts
bun run google.ts useapi:accounts list

# Add account using cookies file
bun run google.ts useapi:accounts add --cookies ./google-cookies.txt

# Show detailed health check
bun run google.ts useapi:health
```

### CAPTCHA Configuration

```bash
# List configured providers
bun run google.ts useapi:captcha list

# Configure a provider
bun run google.ts useapi:captcha --provider ezcaptcha --key YOUR_KEY
bun run google.ts useapi:captcha --provider 2captcha --key YOUR_KEY
bun run google.ts useapi:captcha --provider capsolver --key YOUR_KEY
```

## Cost Estimation

### Video Generation Costs

| CLI value | API model | Notes |
|-----------|-----------|-------|
| `quality` | `veo-3.1-quality` | 8s only, 100 credits |
| `fast`    | `veo-3.1-fast`    | default, 4/6/8s |
| `lite`    | `veo-3.1-lite`    | cheapest Veo tier, 4/6/8s |
| `free`    | `veo-3.1-lite-low-priority` | 0 credits, Ultra $200 only |
| `omni` / `omni-flash` | `omni-flash` | audio-native T2V/R2V/V2V, 4/6/8/10s |

**Note:** Video generation costs are denominated in **credits** — see [GOOGLE-FLOW-V1.md](./GOOGLE-FLOW-V1.md) for the full credit matrix.

The `free` model requires Ultra tier account on useapi.net.

### CAPTCHA Costs

- useapi.net provides free CAPTCHA credits (check with `useapi:health`)
- Or configure your own provider: ~$0.0025 per solve

## Omni Flash, Voice Narration, V2V Edit, Extend & Concatenate

The `omni-flash` model (`--model omni` or `--model omni-flash`) is audio-native and supports text-to-video, reference-to-video, and video-to-video editing. See [GOOGLE-FLOW-V1.md](./GOOGLE-FLOW-V1.md) for the full reference including the credit matrix and all 30 voice presets.

### New CLI Flags

| Flag | Description |
|------|-------------|
| `--duration <4\|6\|8\|10>` | Output video length in seconds |
| `--voice <preset>` | Voice narration preset (see GOOGLE-FLOW-V1.md for the 30 names) |
| `--ref-video <id>` | Reference video `mediaGenerationId` for V2V edit |

### New Subcommands

```bash
# Extend a video
bun run google.ts useapi:extend --media-id <id> --prompt <text>

# Concatenate 2–10 videos
bun run google.ts useapi:concat --media-ids <id1,id2,...>

# Upload an MP4 for V2V edit (returns mediaGenerationId)
bun run google.ts useapi:upload-video --file <path>
```

## API Reference

### Timeouts

| Operation | Timeout |
|-----------|---------|
| Video generation | 3 minutes |
| Polling | 3 minutes |
| Image upload | 1 minute |
| Account operations | 1 minute |
| Other calls | 15 seconds |

### Job Polling

The backend polls every 3 seconds for job completion. Jobs can be in these states:
- `QUEUED` - Waiting to start
- `IN_PROGRESS` - Generating
- `COMPLETED` - Success
- `FAILED` - Error occurred

### History Tracking

Job history is stored in `veo-cli.db` (same SQLite database as direct backend):

```sql
-- View recent useapi.net history
SELECT * FROM useapi_history ORDER BY timestamp DESC LIMIT 10;

-- View success rate
SELECT status, COUNT(*) as count FROM useapi_history GROUP BY status;
```

## Troubleshooting

### Authentication Errors

**Error:** `Authentication failed: Invalid API token`
- Check `USEAPI_API_TOKEN` is set correctly
- Verify token is active in useapi.net dashboard

**Error:** `Account not registered with useapi.net`
- Run `useapi:accounts add` with valid cookies
- Or register account via useapi.net dashboard

### CAPTCHA Errors

**Error:** `CAPTCHA solving failed`
- Check CAPTCHA credits with `useapi:health`
- Configure a CAPTCHA provider if credits exhausted

### Rate Limiting

**Error:** `Rate limited: Please wait before retrying`
- Wait a few minutes before retrying
- Check useapi.net dashboard for rate limit status

### Cookie Format

Cookies must be in one of these formats:

**Tab-separated (Chrome DevTools export):**
```
__Secure-1PSID	value	.google.com	/	2027-01-01	✓	✓
SID	value	.google.com	/	2027-01-01
```

**JSON (Puppeteer format):**
```json
[
  {"name": "__Secure-1PSID", "value": "...", "domain": ".google.com", "path": "/"},
  {"name": "SID", "value": "...", "domain": ".google.com", "path": "/"}
]
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   veo-cli       │     │   useapi.net    │
│   (client)      │────▶│   (service)     │
└─────────────────┘     └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  Google Flow    │
                        │  (Veo 3.x API)  │
                        └─────────────────┘
```

### Backend Interface

Both backends implement the `VideoBackend` interface:

```typescript
interface VideoBackend {
  name: "direct" | "useapi";
  requiresBrowser: boolean;

  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  checkHealth(): Promise<HealthResult>;
  getAccountTier(): Promise<AccountTier>;
  uploadImage(path: string, mode: "frames" | "ingredients"): Promise<ImageUploadResult>;
  generateVideo(request: VideoRequest): Promise<VideoGenerationResult>;
  estimateCost(request: VideoRequest): CostEstimate | null;
}
```

### File Structure

```
src/backends/
├── index.ts          # VideoBackend interface + createBackend() factory
├── types.ts          # Backend-specific types
├── direct/           # Browser automation backend
│   └── index.ts      # DirectBackend class
└── useapi/           # useapi.net REST API backend
    ├── index.ts      # UseApiBackend class
    ├── client.ts     # HTTP client (auth, requests, polling)
    ├── accounts.ts   # Account management commands
    └── generation.ts # Video generation + model mapping
```

## Integration with video-replicator

The video-replicator skill supports both backends via the `--backend` flag:

```bash
# Use direct backend (default)
python parallel_video_gen.py --product my-project --scenes '{"1":"prompt"}' --backend direct

# Use useapi.net backend
python parallel_video_gen.py --product my-project --scenes '{"1":"prompt"}' --backend useapi
```

When using `--backend useapi`, the script automatically adds `--yes` to skip confirmation prompts.
