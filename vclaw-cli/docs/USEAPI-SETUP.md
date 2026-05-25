# Google Flow Setup for useapi.net

> Source: https://useapi.net/docs/start-here/setup-google-flow

Google Flow enables creation of cinematic AI clips using Veo, and image generation with Imagen 4 and Nano Banana/Gemini 2.5 Flash Image. The setup process takes approximately 15 minutes.

## Setup Steps

### 1. Create Gmail Account

A dedicated Gmail account is strongly recommended for API usage. During creation, enable 2-Step Verification using Google Authenticator for enhanced security.

### 2. Clear Browser Cookies

Use a Chromium-based browser (Opera, Brave, Chromium, or Chrome) and remove all existing cookies:

1. Open browser settings
2. Select "Delete browsing data"
3. Choose "All time" as the time range
4. Check "Cookies and other site data"
5. Click "Delete data"

**Tip:** Opera with VPN enabled (set to Americas region) is suggested.

### 3. Access Google Flow

Navigate to https://labs.google/fx/tools/flow and click "Sign in with Google."

### 4. Complete Authentication

1. Enter your Gmail address
2. Complete 2-Step Verification using your authenticator app
3. **CRITICAL:** Check "Don't ask again on this device"

### 5. Extract Cookies

Navigate to https://myaccount.google.com/ and extract cookies:

1. Open Developer Tools (F12 or Cmd+Option+I)
2. Go to **Application → Cookies → `https://accounts.google.com/`**
3. Select all cookies (Ctrl/Cmd+A)
4. Copy all cookies (Ctrl/Cmd+C)
5. Save to a text file (tab-separated format)

### 6. Configure Account via API

Submit cookies to the POST /accounts endpoint:

```bash
# Using veo-cli
bun run google.ts useapi:accounts add --cookies ./google-cookies.txt

# Or with dry-run to validate first
bun run google.ts useapi:accounts add --cookies ./google-cookies.txt --dry-run
```

Clear browser cookies afterward to ensure API-only management.

## Captcha Provider Configuration

### Free Credits

New accounts receive **100 complimentary captcha credits** for testing. Check remaining credits:

```bash
bun run google.ts useapi:health
```

### Supported Providers

| Provider | Cost | Website |
|----------|------|---------|
| EzCaptcha (Recommended) | ~$2.50/1,000 | https://ez-captcha.com |
| CapSolver | ~$3.00/1,000 | https://capsolver.com |
| YesCaptcha | Variable | https://yescaptcha.com |

### Configuration Process

1. Create account with chosen provider(s)
2. Purchase credits and obtain API key
3. Configure key via CLI:

```bash
# Configure EzCaptcha (recommended)
bun run google.ts useapi:captcha --provider ezcaptcha --key YOUR_API_KEY

# List configured providers
bun run google.ts useapi:captcha list
```

### Recommendations

- **EzCaptcha** has been thoroughly tested and shows optimal performance
- Configure multiple providers for redundancy
- Each video generation attempt costs approximately one captcha solve (~$0.0025)

## Required Cookies

The following cookies must be present for successful registration:

- `HSID`
- `LSID`
- `SID`
- `SSID`

If registration fails with "OAuth stuck on login page" error, re-export cookies following the steps above carefully.

## Troubleshooting

### OAuth Stuck on Login Page

This error means cookies weren't exported correctly. Follow these steps:

1. Clear ALL browser cookies first
2. Login to https://labs.google/fx/tools/flow FIRST
3. During 2FA, CHECK "Don't ask again on this device"
4. Then navigate to https://myaccount.google.com
5. Export cookies from `accounts.google.com` domain
6. Try registration again

### Missing Required Cookies

If you see "Missing required cookies: HSID, LSID, SID, SSID":

1. Make sure you're exporting from `accounts.google.com` domain (not `google.com`)
2. Ensure you're logged in before exporting
3. Try using a different browser or clearing all data first

## API Reference

### Endpoints Used by veo-cli

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/google-flow/accounts` | List registered accounts |
| POST | `/google-flow/accounts` | Register account with cookies |
| GET | `/google-flow/accounts/captcha-providers` | List CAPTCHA providers |
| POST | `/google-flow/assets/{email}` | Upload image (raw binary body) |
| POST | `/google-flow/videos` | Generate video (synchronous) |

### Image Upload

Images are uploaded with raw binary body (not base64):

```bash
curl -X POST "https://api.useapi.net/v1/google-flow/assets/{email}" \
  -H "Authorization: Bearer ${USEAPI_API_TOKEN}" \
  -H "Content-Type: image/png" \
  --data-binary @./image.png
```

Returns `mediaGenerationId` for use in video generation.

### Video Generation

The video generation API is **synchronous** - the response includes the completed video URL:

```bash
curl -X POST "https://api.useapi.net/v1/google-flow/videos" \
  -H "Authorization: Bearer ${USEAPI_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@gmail.com",
    "prompt": "A sunset over the ocean",
    "model": "veo-3.1-fast",
    "aspectRatio": "portrait",
    "startImage": "mediaGenerationId-from-upload"
  }'
```

Video URL is in: `response.operations[0].operation.metadata.video.fifeUrl`

## Advantages Over Direct API

| Feature | Direct Backend | useapi.net Backend |
|---------|---------------|-------------------|
| I2V Portrait | ❌ Returns INVALID_ARGUMENT | ✅ Works |
| Browser Required | Yes (Puppeteer) | No |
| Response Type | Async (polling) | Synchronous |
| Reliability | Browser-dependent | High |
| Cost | Free | ~$0.05/video + CAPTCHA |

## Cost Summary

| Component | Cost |
|-----------|------|
| Video (fast model) | $0.05 |
| Video (quality model) | $0.50 |
| Video (free model) | $0.00 (Ultra tier only) |
| CAPTCHA per video | ~$0.0025 |
| **Total (fast)** | **~$0.0525** |
