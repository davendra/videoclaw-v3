# Google Flow v1 — API Reference

Source: https://useapi.net/docs/api-google-flow-v1 (captured 2026-05-22)

Google Flow v1 is useapi.net's managed proxy for Google Veo video generation and Gemini
Omni Flash. It handles Google account rotation, CAPTCHA solving, and credit accounting.
Base URL: `https://api.useapi.net/v1`. Auth: `Authorization: Bearer {API token}`. All
POST bodies are `application/json`; asset uploads send raw binary.

For the friendly model name mappings used in VideoClaw see `veo-cli/CLAUDE.md`.

---

## Models

### § 3.1 Video model matrix (`POST /google-flow/videos`, `model` field)

| API identifier | Generation types | Credits/generation |
|---|---|---|
| `veo-3.1-lite` | T2V / I2V / I2V-FL / R2V (1–3 refs); 4s / 6s / 8s; extend | non-Ultra 10 · Ultra 5 |
| `veo-3.1-lite-low-priority` | Same as `veo-3.1-lite`, lower queue priority | Ultra $200 plan only: **0 credits** |
| `veo-3.1-fast` *(default)* | T2V / I2V / I2V-FL / R2V (1–3 refs); 4s / 6s / 8s; extend | non-Ultra 20 · Ultra 10 |
| `veo-3.1-quality` | T2V / I2V / I2V-FL; **8s only**; extend | 100 |
| `omni-flash` | T2V / R2V (1–7 refs) / V2V edit; 4s / 6s / 8s / 10s | 4s 15 · 6s 20 · 8s 25 · 10s 30 |
| `omni-flash` + `referenceVideo_1` | V2V edit only; output matches trim window | **40 flat** |

> `veo-3.1-lite-low-priority` is only accessible on the Ultra $200 subscription and
> consumes 0 credits, but runs at lower priority than other tiers.

---

## Video request parameters

### § 3.2 Full parameter reference (`POST /google-flow/videos`)

**Core**

| Parameter | Required | Notes |
|---|---|---|
| `prompt` | Yes | Generation prompt text. |
| `model` | No | Default: `veo-3.1-fast`. See model matrix above. |
| `email` | No | Pins the request to a specific configured account. **Omit to enable load balancing** across all configured accounts. |

**Aspect ratio**

| `aspectRatio` | Accepted by |
|---|---|
| `landscape` (default) | All models |
| `portrait` | All models |
| `1:1` | Veo models only |
| `4:3` | Veo models only |
| `3:4` | Veo models only |

`omni-flash` accepts only `landscape` or `portrait`.

**Duration**

| Model / mode | Accepted durations | Notes |
|---|---|---|
| Veo T2V / I2V / I2V-FL | `4` / `6` / `8` | `4` and `6` are Ultra-plan-only; `8` is the default for all tiers |
| Veo R2V | `8` only | Fixed |
| `omni-flash` T2V / R2V | `4` / `6` / `8` / `10` | All accepted |
| `omni-flash` V2V edit | Not accepted | Output length is determined by the frame-index trim window |

**Count and seed**

- `count`: integer 1–4 (default 1). Number of videos to generate in one request.
- `seed`: integer ≥ 0. Optional reproducibility seed.

**Image-to-video (I2V) — Veo only**

- `startImage`: base64 or URL of the first frame. Veo only; omni-flash frames mode is
  "coming soon" and currently rejected.
- `endImage`: base64 or URL of the last frame. Requires `startImage` (end-frame-only
  unsupported). Activates I2V-FL (first+last frames) mode.

**Reference images (R2V)**

- `referenceImage_1` … `referenceImage_7`
- Slots `_1..3`: supported by all Veo models except `veo-3.1-quality`, and by
  `omni-flash`.
- Slots `_4..7`: `omni-flash` only.
- Cannot be combined with `startImage` or `endImage`.

**Voice narration**

- `referenceAudio_1` … `referenceAudio_5` — preset name strings (case-insensitive).
- Slot `_1`: supported by Veo R2V and `omni-flash` (R2V and V2V modes).
- Slots `_2..5`: `omni-flash` only.
- Veo R2V with voice requires at least one `referenceImage_*`.

**V2V edit — `omni-flash` only**

- `referenceVideo_1`: `mediaGenerationId` of a previously generated or uploaded MP4.
  Presence switches the request into V2V mode.
- `startFrameIndex_1`: integer 0–239. Start of the trim window on a virtual 24 fps
  timeline (0 = frame 0, i.e. 0 s).
- `endFrameIndex_1`: integer 1–240. End of the trim window (240 = 10 s at 24 fps).
- Cannot be combined with `referenceImage_*`.
- `duration` is not accepted in V2V mode.

**Async / webhook**

- `async` (default `false` → synchronous 200). Set `true` for 201 + async poll.
- `replyUrl`: webhook URL called when the job completes.
- `replyRef`: opaque string echoed back in the webhook payload.

**CAPTCHA** (mutually exclusive options)

- `captchaToken`: pre-solved CAPTCHA token string.
- `captchaRetry`: integer 1–10 (default 3). Number of CAPTCHA solve attempts before
  giving up.
- `captchaOrder`: string. Specifies CAPTCHA provider order.

---

## Voice presets

### § 3.2 (continued) — 30 preset names

Achird, Achernar, Algieba, Algenib, Alnilam, Aoede, Autonoe, Callirrhoe, Charon,
Despina, Enceladus, Erinome, Fenrir, Gacrux, Iapetus, Kore, Laomedeia, Leda, Orus,
Puck, Pulcherrima, Rasalgethi, Sadachbia, Sadaltager, Schedar, Sulafat, Umbriel,
Vindemiatrix, Zephyr, Zubenelgenubi.

Audio samples: `https://www.gstatic.com/aitestkitchen/voices/samples/{Name}.wav`
(replace `{Name}` with the exact preset name, e.g. `Aoede.wav`).

---

## Mode quick-reference

### § Mode rules

| Mode | Required fields | Supported models |
|---|---|---|
| T2V (text-to-video) | `prompt` only | All models |
| I2V (image-to-video) | `startImage` | Veo only |
| I2V-FL (first+last frames) | `startImage` + `endImage` | Veo only |
| R2V (reference images) | `referenceImage_1` (+ up to _3 or _7) | Veo (not `quality`); `omni-flash` |
| V2V (video edit) | `referenceVideo_1` + frame indices | `omni-flash` only |

---

## Endpoints

### § 3.4 Endpoint catalogue

**`POST /google-flow/videos`**
Main generation endpoint. Accepts all parameters from § 3.2. Synchronous (200) or
async (201). CAPTCHA required.

**`POST /google-flow/videos/extend`**
Extends an existing video by an ~8s segment (~1s overlap with source).
Body: `{ mediaGenerationId, prompt, model?, count?, seed?, async?, replyUrl?, replyRef?, captcha* }`.
CAPTCHA required.
Supported models: `veo-3.1-fast`, `veo-3.1-quality`, `veo-3.1-lite`,
`veo-3.1-lite-low-priority`.

**`POST /google-flow/videos/concatenate`**
Joins 2–10 videos into one. No CAPTCHA required.
Body: `{ media: [{ mediaGenerationId, trimStart?, trimEnd? }, …] }`.
Constraints: all inputs must belong to the same account and share the same aspect ratio.
**Veo-lineage only** — `omni-flash` outputs are not eligible for concatenation;
the API returns `400 "Concatenation failed"` if any input was produced by
`omni-flash`. Only `veo-3.1-quality / -fast / -lite / -lite-low-priority` videos
and their `/videos/extend` extensions can be concatenated. (Verified live
2026-05-24; the `concatenateVideos` client method surfaces an actionable hint
for this case.)
Returns: `{ jobId, status, inputsCount, encodedVideo }` where `encodedVideo` is a
base64-encoded MP4.

**`POST /google-flow/videos/gif`**
Converts a video to a GIF preview. No CAPTCHA required.
Body: `{ mediaGenerationId }`.
Returns: `{ encodedGif }` (base64).

**`POST /google-flow/videos/upscale`**
Upscales a video. CAPTCHA required.
Body: `{ mediaGenerationId, resolution? }`.
`resolution`: `1080p` (default, free) or `4K` (50 credits, result cached).

**`POST /google-flow/images`**
Generates images. No CAPTCHA noted in spec.
Body fields: `prompt` (required), `model` (`imagen-4` default / `nano-banana-2` /
`nano-banana-pro`; `nano-banana` accepted as a legacy alias for `nano-banana-2`),
`reference_1..10` (imagen-4 max 3 refs; others up to 10), `aspectRatio`
(`16:9` / `4:3` / `1:1` / `3:4` / `9:16` / `auto`; legacy `landscape` / `portrait`
aliases accepted).

**`POST /google-flow/images/upscale`**
Upscales a previously generated image.
Body: `{ mediaGenerationId, resolution? }` (`2k` or `4k`).
Only `nano-banana-pro` and `nano-banana-2` images are eligible.

**`POST /google-flow/assets/{email}`**
Raw binary upload to the Asset Library. `Content-Type` must be one of:
`image/png`, `image/jpeg`, `image/webp` (max 20 MB) or `video/mp4` (max 100 MB).
Video uploads return `durationSeconds` — use this to compute `endFrameIndex_1` for V2V
(`durationSeconds × 24`, capped at 240).

**`GET /google-flow/jobs/{jobId}`**
Polls async job status. Response contains `response.media[]` (preferred) or
`response.operations[]` for upscale jobs.

---

## Response shapes

**200 sync:** `{ jobId, media[], remainingCredits, captcha }`.
Each `media` item: `name`, `mediaGenerationId`, `videoUrl` (signed MP4, ~24h TTL),
`thumbnailUrl`, `video.generatedVideo` (`seed`, `model`, `aspectRatio`, …),
`video.dimensions.length`.

**201 async:** `{ jobid, type, status:"created", created, request, response }` where
`response.operations[]` carries `operation.name`, `sceneId`, `status`.

**Upscale 200:** Returns both `operations[]` (legacy, includes `fifeUrl`) and `media[]`.

**Error:** `{ jobId?, error, code?, response? }`. Load-balancer empty-set errors add
`message`, `retryAfter`, `skipReasons[]`.

> The VideoClaw client prefers `media[]` and falls back to `operations[]`; this handles
> all three response shapes with one code path.

---

## Error-reason playbook

### § 3.5 Retry strategy by status and reason

| HTTP status | Condition | Action |
|---|---|---|
| 429 `RESOURCE_EXHAUSTED` | `reason: PUBLIC_ERROR_UNUSUAL_ACTIVITY_TOO_MUCH_TRAFFIC` | Captcha provider overloaded. Spread across providers or increase `captchaRetry`. |
| 429 `RESOURCE_EXHAUSTED` | `reason: PUBLIC_ERROR_USER_REQUESTS_THROTTLED` | Per-user concurrency limit hit. Hold ~1 hour before retrying. |
| 429 `RESOURCE_EXHAUSTED` | `reason: PUBLIC_ERROR_PER_MODEL_DAILY_QUOTA_REACHED` | Per-model daily quota exhausted. Hold until next day or switch model. |
| 429 `RESOURCE_EXHAUSTED` | `reason: PUBLIC_ERROR_USER_QUOTA_REACHED` | Account-wide quota reached. Add more accounts or omit `email` to enable load balancing. |
| 429 any | `error: "no_eligible_account"` + `Retry-After` header | Load balancer has no eligible account (all quarantined). Wait for `Retry-After` seconds. |
| 403 | Captcha rejected | Increase `captchaRetry` (max 10) or supply a pre-solved `captchaToken`. |
| 503 | Transient or captcha-provider failure | Retry with backoff. |
| 596 | Session refresh failed | Re-add the Google account in the useapi.net dashboard. |

## Known issues

### Omni Flash V2V edit is being false-positive-rejected at Google's safety filter

**Status:** Known Google bug, no ETA for fix. Tracked at Google internal `b/515000564`.

Calls to `POST /google-flow/videos` with `model:"omni-flash"` + `referenceVideo_1`
(V2V edit) consistently return:

```
400 PUBLIC_ERROR_UNSAFE_GENERATION
mediaStatus.failureReasons: ["FINISH_REASON_INPUT_VIDEO_EDIT"]
visibility: "FILTERED"
```

Even on innocuous prompts and procedural (non-AI) source video. This is **not a
code defect** — the request reaches the `abra_edit` model, the model loads and
generates a 10s output, and the response is parsed correctly. The block is
post-generation at Google's content-safety layer. **No credits are charged**
for filtered outputs.

The same bug affects the Flow web UI and the Gemini app — it is not specific to
the API. Google VP Josh Woodward acknowledged on X: *"this shouldn't be
happening."* Community discussion + tracker:
- [Google AI Developers Forum thread](https://discuss.ai.google.dev/t/omni-video-editing-instantly-rejects-harmless-prompts-in-flow-and-gemini-app/147152)
- [PiunikaWeb summary (May 20, 2026)](https://piunikaweb.com/2026/05/20/google-investigating-issue-gemini-omni-flash/)

**Action:** Wait for Google to fix the filter; the existing `generateVideo`
client method requires no changes when V2V starts working again.

### Speech editing is officially restricted (not a bug)

V2V edit calls that also include `referenceAudio_*` may return
`FINISH_REASON_INPUT_SPEECH_EDIT`. Per the Google DeepMind
[Gemini Omni Flash model card](https://deepmind.google/models/model-cards/gemini-omni-flash/):

> *Gemini Omni Flash is capable of changing people's speech. For now, we are
> restricting this capability and working to better understand how to safely
> and responsibly bring it to our users.*

This is a permanent policy decision until Google relaxes it; no client-side
workaround.
