# Seedance 2.0 Transport Payloads — videoclaw reference

> **One model, three gateways.** `seedance-direct`, `runway-useapi`, and `dreamina-useapi`
> all generate with the **Seedance 2.0** model — they differ only in the API gateway in
> front of it. So the same prompt grammar, the same multi-reference identity-lock, the same
> content moderation, and the same 9/3/3 reference budget apply to **all three**. This file
> is the canonical, agent-readable reference for how to build the request to each.
>
> Confirmed 2026-05-30 from the live UseAPI docs (`useapi.net/docs/api-runwayml-v1`,
> `useapi.net/docs/api-dreamina-v1`), the skill client `skills/video-replicator/scripts/seedance_client.py`,
> and the production xskill/ARK payloads. Related: `ark-multireference-payload-contract` (memory),
> `references/video/multi-shot-framework.md`, `references/video/seedance-ugc-formulas.md`.

---

## The canonical contract (what makes Seedance lock identity)

Every Seedance submission, on any gateway, should follow this:

1. **Multi-reference — one image reference per character.** Use the gateway's per-character
   reference field (below), pointing at **managed asset references** (ARK `Asset://` avatars /
   UseAPI uploaded asset ids), never raw photoreal face URLs (those trip the real-person filter
   and don't lock identity).
2. **Positional, visual-descriptor text — never proper names.** Describe each character by what
   they look like and where they are: *"Center: long dark braid + dark coat (dual pistols). Left:
   hooded olive jacket + sniper rifle. Right: tank top + twin knives."* The **order of the
   reference fields matches the positional mapping** (ARK/UseAPI honor reference order).
3. **No-face-morph line:** *"Keep each character identical to her reference image, no face morphing."*
4. **Single-full-frame guard:** *"single continuous full-frame cinematic shot, no on-screen text."*
   (Prevents grid/split-screen leakage when a storyboard grid is among the refs.)
5. **The look in the text:** grade + grain + lighting + register
   (e.g. *"desaturated earth tones, hard backlight, heavy 35mm film grain, Aditya Dhar war-thriller realism"*).

**Output-dependent variables (parameters, NOT hardcoded — vary by the shot you need):**
- `resolution` — 720p draft vs 1080p final (and the reference-asset resolution).
- `duration` — e.g. 8s.
- **scene-timing / TIMELINE** — a single kinetic shot has **no** timeline; a multi-beat sequence
  includes one. Include it conditionally.
- **audio** — off → omit; on → the text carries an explicit **diegetic soundscape**
  (*"Diegetic sound only: wind, distant fire, embers, footsteps on grit. No music."*).

---

## Gateway A — `seedance-direct` (xskill / ARK)

- **Host:** `https://api.xskill.ai` (env `VCLAW_SEEDANCE_BASE_URL`; auth `SUTUI_API_KEY`).
- **Create:** `POST /api/v3/tasks/create` · **Poll:** `POST /api/v3/tasks/query` ·
  **Cancel:** `POST /api/v3/tasks/cancel` · **Assets:** `POST /api/v3/assets` (+ `/assets/groups`).
- **Body shape (flat task-create wrapper):**
  ```json
  {
    "model": "ark/seedance-2.0",
    "params": {
      "prompt": "<full text>",
      "ratio": "16:9",
      "duration": "8",                // STRING for ARK
      "model": "seedance_2.0",         // or "seedance_2.0_fast" (quality vs fast)
      "resolution": "1080p",
      "generate_audio": false,
      "watermark": false,
      "reference_images": ["Asset://...1", "Asset://...2", "Asset://...3"]
    },
    "channel": null
  }
  ```
- **Reference rule** (`image_url` and `reference_images` are MUTUALLY EXCLUSIVE):
  - 1 image → `image_url` (first-frame I2V).
  - multiple images, all `Asset://` → `reference_images: [...]` (multi-character lock).
  - mixed raw-HTTP + `Asset://` → use `image_url` only (drop sheets — raw faces trip the filter).
  - also `reference_videos` (≤3), `reference_audios` (≤3).
- **Asset Library:** register character images as avatars (`vclaw video seedance-register-assets`
  → `artifacts/seedance-assets.json` → `Asset://` URIs) — this is the identity-lock mechanism.
- **Newer "ARK passthrough" shape** (the production payload some accounts use; different endpoint):
  `{ model:"ep-...", content:[{type:"text",text},{type:"image_url",image_url:{url:"asset://..."},role:"reference_image"}...], ratio, resolution, duration, generate_audio, watermark, _sub_model:"seedance_2.0", _ark_profile:"intl", _content_filter:"on", _api_key_id }`.
  This is the OpenAI-style multimodal content-array form; `seedance_client.py` and videoclaw
  currently use the flat `params` form above.

## Gateway B — `runway-useapi` (Seedance 2.0 via UseAPI's Runway proxy)

- **Host:** `https://api.useapi.net/v1` (auth `USEAPI_API_TOKEN` bearer).
- **Create:** `POST /runwayml/videos/create` (unified endpoint; `model:"seedance-2"`).
  **Assets:** `POST /runwayml/assets` → returns UUID `assetId`. Poll: `GET /runwayml/tasks/{taskId}`.
- **Multi-reference (up to 11 mixed images+videos):** individual fields, **NOT an array**:
  - `imageAssetId1` … `imageAssetId11` (UUID `assetId` each).
  - `videoAssetId`, `videoAssetId2`, `videoAssetId3` (≤3 videos, ≤15s/≤720p each).
  - prompt references them as `@IMG_1`…`@IMG_11`, `@VID_1`…`@VID_3`.
- **Keyframe mode (mutually exclusive with multi-ref):** `startFrameAssetId`, `endFrameAssetId`.
- **Core fields:** `model:"seedance-2"`, `text_prompt` (≤3500 chars), `duration` 4–15,
  `aspect_ratio` (16:9/9:16/1:1/4:3/3:4/21:9), `resolution` 480p/720p/1080p, `audio` bool (default true),
  `seed`, `exploreMode` bool (default false — explore = free/queued/low-res).
- **videoclaw today (`native-runway.ts` / `providers/runway-useapi.ts`):** sends only ONE
  keyframe (`startFrameAssetId`) — **does NOT yet use `imageAssetId1..N` multi-reference.** ⚠️

## Gateway C — `dreamina-useapi` (Seedance 2.0 via UseAPI's Dreamina proxy)

- **Host:** `https://api.useapi.net/v1` (auth `USEAPI_API_TOKEN`; account `VCLAW_DREAMINA_ACCOUNT`,
  e.g. `CA:ai@example.com`).
- **Create:** `POST /dreamina/videos` · **Poll:** `GET /dreamina/videos/{jobid}` ·
  **Assets:** `POST /dreamina/assets/{account}` → returns an `assetRef`.
- **Omni Reference (multi-character; up to 9 img + 3 video + 3 audio):** individual fields:
  - `omni_1_imageRef` … `omni_9_imageRef` (each an `assetRef`).
  - `omni_1_videoRef`…`omni_3_videoRef`, `omni_1_audioRef`…`omni_3_audioRef`.
  - prompt references them as `@imageN` / `@videoN` / `@audioN`.
- **Frame modes:** `firstFrameRef`, `endFrameRef` (needs firstFrameRef), `frame_N_imageRef` (N=1–10).
- **Core fields:** `model:"seedance-2.0"` (or `-fast`), `prompt` (≤5000 chars), `ratio` (default 16:9,
  auto-detected from refs), `resolution` 720p/1080p (1080p = CA accounts), `duration` (default 5),
  `account`, `replyUrl`/`replyRef` (webhooks). **Input mode auto-detected** from which fields are present.
  No documented `generate_audio` field.
- **videoclaw today (`native-dreamina.ts`):** sends only ONE `firstFrameRef` — **does NOT yet use
  `omni_N_imageRef` multi-reference.** ⚠️

---

## Reference-field cheat sheet (per character → field)

| Gateway | Endpoint | Per-character image field | Prompt placeholder | Cap | Asset source |
|---|---|---|---|---|---|
| seedance-direct (ARK) | `xskill /api/v3/tasks/create` | `reference_images: [a,b,c]` (array) | (positional in text) | 9 img / 3 vid / 3 aud | `Asset://` avatar (Asset Library) |
| runway-useapi | `useapi /runwayml/videos/create` | `imageAssetId1..11` (individual) | `@IMG_1..@IMG_11` | 11 mixed (≤3 vid) | `assetId` from `POST /runwayml/assets` |
| dreamina-useapi | `useapi /dreamina/videos` | `omni_N_imageRef` N=1..9 (individual) | `@imageN` | 9 img / 3 vid / 3 aud | `assetRef` from `POST /dreamina/assets/{account}` |

---

## Content moderation (Seedance, all gateways)

Server-side filters (tightened Feb 2026). Port in `src/video/seedance-content-filter.ts`
(from `seedance_client.py`): `preValidatePrompt` (HIGH = celebrity/IP, minors, NSFW, political;
MEDIUM = photoreal portrait, violence, brands), `sanitizePrompt(level 1|2)` (preserves `@image/@video/@audio`
refs), `isContentViolation` (error code **2038** + Chinese 违规 patterns) → **retry-with-sanitization**.
HIGH-risk → almost always blocked: real human faces as refs (use Asset/avatar refs), minors,
celebrity/IP, NSFW, political. SAFE: stylized characters by visual descriptor, camera/motion language,
own AI-generated stylized refs.

## Consistency status (2026-05-30)

| Item | seedance-direct | runway-useapi | dreamina-useapi |
|---|---|---|---|
| Multi-reference identity-lock | ✅ `reference_images` | ❌ single keyframe (target: `imageAssetId1..N`) | ❌ single keyframe (target: `omni_N_imageRef`) |
| Content-filter / 2038 retry | being wired (`seedance-content-filter.ts`) | target: reuse same module | target: reuse same module |
| Text discipline (descriptor/no-morph/single-frame) | shared `filmmaking-prompts.ts` packet builder → all routes | ✓ via shared builder | ✓ via shared builder |
| Resolution / duration params | ✅ | ✅ | ✅ |
| Scene-timing as parameter | target | target | target |

Tracking branch: `feat/transport-skill-consistency`.
