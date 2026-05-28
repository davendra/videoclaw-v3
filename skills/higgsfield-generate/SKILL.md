---
name: higgsfield-generate
description: |
  Higgsfield bridge for videoclaw agents. Use when the user wants
  Higgsfield AI generation, Marketing Studio ad videos, product photoshoots,
  Soul identity training, marketplace cards, image-to-video, or finished-video
  virality scoring. This skill reuses the public MIT-licensed
  higgsfield-ai/skills command intelligence without vendoring the whole repo.
---

# Higgsfield Generate

This is a videoclaw bridge skill for Higgsfield AI. It routes requests into the
official `higgsfield` CLI while keeping videoclaw's core production state in the
`vclaw video ...` surface when a project artifact trail is needed.

## Source And Reuse Boundary

Reference source:
- `higgsfield-ai/skills` at commit `5af0258255919ff918390ee82b498727ca8e8b89`
- Version observed: `0.3.0`
- License: MIT

Reuse stance:
- Reuse the command patterns, model-routing heuristics, and UX guardrails.
- Do not vendor Higgsfield's setup script into videoclaw.
- Do not add `higgsfield` as a hard dependency of videoclaw.
- Keep Higgsfield authentication interactive and external to videoclaw.
- If a result needs project history, save the returned media URL/path into the
  relevant videoclaw project artifact or handoff note after generation.

## Bootstrap

Before running a Higgsfield command:

```bash
command -v higgsfield
higgsfield account status
```

If the CLI is missing, install it from Higgsfield's official installer:

```bash
curl -fsSL https://raw.githubusercontent.com/higgsfield-ai/cli/main/install.sh | sh
```

If auth is missing or expired, ask the user to run:

```bash
higgsfield auth login
```

Do not handle credentials directly.

## Route Selection

Use this skill for:
- Branded ad video, UGC, unboxing, product demo, presenter ad, TV spot
- Product photoshoot, hero banner, Pinterest pin, social carousel, ad creative
  pack, virtual try-on, marketplace cards
- Soul Character training or face-faithful identity reuse
- Image-to-video or video generation when the user explicitly asks for
  Higgsfield models
- Finished-video hook, attention, retention, or virality scoring

Prefer videoclaw's native `video-framework` / `ugc` / `movie-director` skills
when the user wants a full videoclaw project with approvals, checkpoints,
review UI, candidate selection, publish gates, or Obsidian portfolio tracking.

## Commands

### Generic Image Or Video

Pick a model using the Higgsfield model catalog:

```bash
higgsfield model list --json
higgsfield model get <model_id> --json
```

Submit and wait in one call:

```bash
higgsfield generate create <model_id> \
  --prompt "<prompt>" \
  --wait
```

Useful defaults:
- Image/design/text-heavy visuals: `gpt_image_2`
- Serious image-to-video or cinematic clips: `seedance_2_0`
- Character/reference-image work: `nano_banana_2`
- Branded ads: `marketing_studio_video` or `marketing_studio_image`
- Virality scoring: `brain_activity`

### Product Photoshoot

Use the dedicated backend enhancer instead of freehanding a raw image prompt:

```bash
higgsfield product-photoshoot create \
  --mode <product_shot|lifestyle_scene|closeup_product_with_person|moodboard_pin|hero_banner|social_carousel|ad_creative_pack|virtual_model_tryout|conceptual_product|restyle> \
  --prompt "<short product/use-case intent>" \
  --image <path-or-upload-id> \
  --count <1-10>
```

### Marketing Studio Video

Use this for UGC, presenter, unboxing, product showcase, review, TV spot, and
try-on videos.

```bash
higgsfield generate create marketing_studio_video \
  --prompt "<ad concept>" \
  --mode <ugc|ugc_how_to|ugc_unboxing|product_showcase|product_review|tv_spot|wild_card|ugc_virtual_try_on|virtual_try_on> \
  --duration 15 \
  --aspect_ratio 9:16 \
  --wait
```

When the user gives a product URL:

```bash
higgsfield marketing-studio products fetch --url <product-url> --wait
higgsfield generate create marketing_studio_video \
  --url <product-url> \
  --mode ugc \
  --duration 15 \
  --aspect_ratio 9:16 \
  --wait
```

### Virality Predictor

Use `brain_activity` for finished-video analysis:

```bash
higgsfield generate create brain_activity \
  --video <local-video-path-or-upload-id> \
  --wait
```

Return the useful score/report summary and report link. Do not dump raw JSON
unless the user asks for machine-readable output.

## Videoclaw Hand-Off

For standalone Higgsfield generation, return URLs directly.

For a videoclaw project, record the hand-off clearly:

```bash
vclaw video set-meta --project <slug> --tag higgsfield --tag external-provider
vclaw video status --project <slug>
```

If the Higgsfield output becomes an input for videoclaw post-production, attach
or import the media through the existing project flow rather than inventing a
new artifact shape.

## Guardrails

- Do not silently replace a requested Higgsfield route with Veo, Seedance,
  Runway, or local image generation.
- Do not expose raw job IDs in normal chat unless they are needed for polling or
  debugging.
- Do not batch-question. Ask only for the missing product, avatar, aspect ratio,
  or mode needed for the next command.
- Do not copy Higgsfield's whole skill repository into videoclaw. Treat it as an
  upstream reference and keep this bridge thin.
