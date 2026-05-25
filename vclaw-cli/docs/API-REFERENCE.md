# Google Labs Flow API Reference

This document provides comprehensive documentation for the Google Labs Flow (Veo) API endpoints used by the veo-cli automation tool.

## Table of Contents

- [API Endpoints](#api-endpoints)
- [Video Models](#video-models)
- [Aspect Ratios](#aspect-ratios)
- [Model Capabilities](#model-capabilities)
- [Generation Modes](#generation-modes)
- [Paygate Tiers](#paygate-tiers)
- [Credit Costs](#credit-costs)

---

## API Endpoints

### tRPC Endpoints (Project & Settings Management)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/fx/api/trpc/project.searchUserProjects` | GET | List all user projects |
| `/fx/api/trpc/project.createProject` | POST | Create a new project |
| `/fx/api/trpc/project.searchProjectWorkflows` | GET | List workflows in a project |
| `/fx/api/trpc/videoFx.getUserSettings` | GET | Get user preferences |
| `/fx/api/trpc/videoFx.getVideoModelConfig` | GET | Get all available video models |
| `/fx/api/trpc/videoFx.setLastSelectedVideoModelKey` | POST | Set preferred model |
| `/fx/api/trpc/videoFx.setLastSelectedVideoAspectRatio` | POST | Set preferred aspect ratio |

### Video Generation Endpoints (aisandbox-pa.googleapis.com)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/video:batchAsyncGenerateVideoText` | POST | Text-to-Video generation |
| `/v1/video:batchAsyncGenerateVideoStartImage` | POST | Image-to-Video (start frame) |
| `/v1/video:batchAsyncGenerateVideoFrames` | POST | Frames-to-Video (start + end) |
| `/v1/video:batchAsyncGenerateVideoReferenceImages` | POST | Ingredients/References generation |
| `/v1/video:batchCheckAsyncVideoGenerationStatus` | POST | Poll generation status |
| `/v1/credits` | GET | Check account credits |

---

## Video Models

### Text-to-Video Models (T2V)

| Model Key | Display Name | Aspect Ratio | Audio | Credits | Status |
|-----------|--------------|--------------|-------|---------|--------|
| `veo_3_1_t2v` | Veo 3.1 - Quality | Landscape | Beta Audio | 100 | Active |
| `veo_3_1_t2v_portrait` | Veo 3.1 - Quality | Portrait | Beta Audio | 100 | Active |
| `veo_3_1_t2v_fast_ultra` | Veo 3.1 - Fast | Landscape | Beta Audio | 10 | Active |
| `veo_3_1_t2v_fast_portrait_ultra` | Veo 3.1 - Fast | Portrait | Beta Audio | 10 | Active |
| `veo_3_1_t2v_fast_ultra_relaxed` | Veo 3.1 - Fast [Lower Priority] | Landscape | Beta Audio | Free | Active |
| `veo_3_1_t2v_fast_portrait_ultra_relaxed` | Veo 3.1 - Fast [Lower Priority] | Portrait | Beta Audio | Free | Active |
| `veo_2_0_t2v` | Veo 2 - Quality | Landscape | No Audio | 100 | Active |
| `veo_2_1_fast_d_15_t2v` | Veo 2 - Fast | Landscape | No Audio | 10 | Active |

### Image-to-Video Models (I2V - Start Frame)

| Model Key | Display Name | Aspect Ratio | Audio | Credits | Status |
|-----------|--------------|--------------|-------|---------|--------|
| `veo_3_1_i2v_s` | Veo 3.1 - Quality | Landscape | Beta Audio | 100 | Active |
| `veo_3_1_i2v_s_portrait` | Veo 3.1 - Quality | Portrait | Beta Audio | 100 | Active |
| `veo_3_1_i2v_s_fast_ultra` | Veo 3.1 - Fast | Landscape | Beta Audio | 10 | Active |
| `veo_3_1_i2v_s_fast_portrait_ultra` | Veo 3.1 - Fast | Portrait | Beta Audio | 10 | Active |
| `veo_3_1_i2v_s_fast_ultra_relaxed` | Veo 3.1 - Fast [Lower Priority] | Landscape | Beta Audio | Free | Active |
| `veo_3_1_i2v_s_fast_portrait_ultra_relaxed` | Veo 3.1 - Fast [Lower Priority] | Portrait | Beta Audio | Free | Active |
| `veo_2_0_i2v` | Veo 2 - Quality | Landscape | No Audio | 100 | Active |
| `veo_2_1_fast_d_15_i2v` | Veo 2 - Fast | Landscape | No Audio | 10 | Active |

### Frames-to-Video Models (I2V-FL - Start + End Frame)

| Model Key | Display Name | Aspect Ratio | Audio | Credits | Status |
|-----------|--------------|--------------|-------|---------|--------|
| `veo_3_1_i2v_s_fl` | Veo 3.1 - Quality | Landscape | Beta Audio | 100 | Active |
| `veo_3_1_i2v_s_portrait_fl` | Veo 3.1 - Quality | Portrait | Beta Audio | 100 | Active |
| `veo_3_1_i2v_s_fast_ultra_fl` | Veo 3.1 - Fast | Landscape | Beta Audio | 10 | Active |
| `veo_3_1_i2v_s_fast_portrait_ultra_fl` | Veo 3.1 - Fast | Portrait | Beta Audio | 10 | Active |
| `veo_3_1_i2v_s_fast_fl_ultra_relaxed` | Veo 3.1 - Fast [Lower Priority] | Landscape | Beta Audio | Free | Active |
| `veo_3_1_i2v_s_fast_portrait_fl_ultra_relaxed` | Veo 3.1 - Fast [Lower Priority] | Portrait | Beta Audio | Free | Active |
| `veo_2_1_fast_d_15_with_start_image_and_end_image_interpolation` | Veo 2 - Fast | Landscape | No Audio | 10 | Active |

### Ingredients-to-Video Models (R2V - Multi-Reference)

| Model Key | Display Name | Aspect Ratio | Audio | Max Images | Credits | Status |
|-----------|--------------|--------------|-------|------------|---------|--------|
| `veo_3_0_r2v_fast_ultra` | Veo 3.1 - Fast | Landscape | Beta Audio | 3 | 10 | Active |
| `veo_3_0_r2v_fast_ultra_relaxed` | Veo 3.1 - Fast [Lower Priority] | Landscape | Beta Audio | 3 | Free | Active |
| `veo_3_0_r2v_fast` | Veo 3.1 - Fast | Landscape | Beta Audio | - | 20 | Active |

### Video Extension Models (Extend)

| Model Key | Display Name | Aspect Ratio | Audio | Credits | Status |
|-----------|--------------|--------------|-------|---------|--------|
| `veo_3_1_extend_landscape` | Veo 3.1 - Quality | Landscape | Beta Audio | 100 | Active |
| `veo_3_1_extend_portrait` | Veo 3.1 - Quality | Portrait | Beta Audio | 100 | Active |
| `veo_3_1_extend_fast_landscape_ultra` | Veo 3.1 - Fast | Landscape | Beta Audio | 10 | Active |
| `veo_3_1_extend_fast_portrait_ultra` | Veo 3.1 - Fast | Portrait | Beta Audio | 10 | Active |
| `veo_3_1_extend_fast_landscape_ultra_relaxed` | Veo 3.1 - Fast [Lower Priority] | Landscape | Beta Audio | Free | Active |
| `veo_3_1_extend_fast_portrait_ultra_relaxed` | Veo 3.1 - Fast [Lower Priority] | Portrait | Beta Audio | Free | Active |
| `veo_2_1_fast_d_15_with_video_extension` | Veo 2 - Fast | Landscape | No Audio | 10 | Active |

### Upscaling Models

| Model Key | Display Name | Resolutions | Credits | Status |
|-----------|--------------|-------------|---------|--------|
| `veo_3_1_upsampler_1080p` | Veo 3.1 - Upsampler 1080P | 1080P | Free | Active |
| `veo_3_1_upsampler_4k` | Veo 3.1 - Upsampler 4K | 4K | 50 | Active |
| `veo_2_1080p_upsampler_8s` | Veo 2 - Upsampler | 1080P | Free | Active |

### Special Models

| Model Key | Display Name | Capability | Credits | Status |
|-----------|--------------|------------|---------|--------|
| `veo_2_0_object_insertion_landscape` | Veo 2 - Fast | Object Insertion | 20 | Active |
| `veo_2_0_object_insertion_portrait` | Veo 2 - Fast | Object Insertion | 20 | Active |
| `veo_2_0_object_removal_landscape` | Veo 2 - Fast | Object Removal | 20 | Active |
| `veo_2_0_object_removal_portrait` | Veo 2 - Fast | Object Removal | 20 | Active |
| `veo_3_0_reshoot_landscape` | Veo 2 - Fast | Reshoot | 20 | Active |
| `veo_3_0_reshoot_portrait` | Veo 2 - Fast | Reshoot | 20 | Active |

---

## Aspect Ratios

| API Value | Display Name | Dimensions |
|-----------|--------------|------------|
| `VIDEO_ASPECT_RATIO_LANDSCAPE` | Landscape (16:9) | 1920x1080 |
| `VIDEO_ASPECT_RATIO_PORTRAIT` | Portrait (9:16) | 1080x1920 |

---

## Model Capabilities

| Capability | Description |
|------------|-------------|
| `VIDEO_MODEL_CAPABILITY_TEXT` | Text-to-Video generation |
| `VIDEO_MODEL_CAPABILITY_START_IMAGE` | Image-to-Video (single start frame) |
| `VIDEO_MODEL_CAPABILITY_START_IMAGE_AND_END_IMAGE` | Frames-to-Video (start + end interpolation) |
| `VIDEO_MODEL_CAPABILITY_MULTI_REFERENCE` | Multi-reference with style support |
| `VIDEO_MODEL_CAPABILITY_MULTI_REFERENCE_NO_STYLE` | Multi-reference without style |
| `VIDEO_MODEL_CAPABILITY_VIDEO_EXTENSION` | Video extension/continuation |
| `VIDEO_MODEL_CAPABILITY_UPSCALING` | Video upscaling |
| `VIDEO_MODEL_CAPABILITY_AUDIO` | Audio generation support |
| `VIDEO_MODEL_CAPABILITY_CAMERA_CONTROL` | Camera movement control |
| `VIDEO_MODEL_CAPABILITY_OBJECT_INSERTION` | Insert objects into video |
| `VIDEO_MODEL_CAPABILITY_OBJECT_REMOVAL` | Remove objects from video |
| `VIDEO_MODEL_CAPABILITY_RESHOOT` | Reshoot/regenerate parts |

---

## Generation Modes

### Text to Video (T2V)

Generate videos from text prompts only.

**Endpoint:** `POST /v1/video:batchAsyncGenerateVideoText`

**Payload:**
```json
{
  "clientContext": {
    "tool": "TOOL_VIDEO_FX",
    "sessionId": "uuid",
    "projectId": "uuid"
  },
  "requests": [{
    "aspectRatio": "VIDEO_ASPECT_RATIO_LANDSCAPE",
    "seed": 12345,
    "textInput": {
      "prompt": "Your video description"
    },
    "videoModelKey": "veo_3_1_t2v",
    "metadata": {
      "sceneId": "uuid"
    }
  }]
}
```

### Frames to Video (I2V - Start Frame Only)

Generate videos from a single start image.

**Endpoint:** `POST /v1/video:batchAsyncGenerateVideoStartImage`

**Payload:**
```json
{
  "clientContext": { ... },
  "requests": [{
    "aspectRatio": "VIDEO_ASPECT_RATIO_LANDSCAPE",
    "seed": 12345,
    "textInput": {
      "prompt": "Motion description"
    },
    "startImage": {
      "mediaId": "CAMaJD..."
    },
    "videoModelKey": "veo_3_1_i2v_s",
    "metadata": {
      "sceneId": "uuid"
    }
  }]
}
```

**Note:** The `mediaId` must be obtained from images already uploaded to your Flow library via the web UI.

### Frames to Video (I2V-FL - Start + End Frame)

Generate videos that interpolate between start and end frames.

**Endpoint:** `POST /v1/video:batchAsyncGenerateVideoFrames`

**Payload:**
```json
{
  "clientContext": { ... },
  "requests": [{
    "aspectRatio": "VIDEO_ASPECT_RATIO_LANDSCAPE",
    "seed": 12345,
    "textInput": {
      "prompt": "Transition description"
    },
    "startImage": {
      "mediaId": "CAMaJD..."
    },
    "endImage": {
      "mediaId": "CAMaJD..."
    },
    "videoModelKey": "veo_3_1_i2v_s_fl",
    "metadata": {
      "sceneId": "uuid"
    }
  }]
}
```

### Ingredients to Video (R2V - Multi-Reference)

Generate videos using 1-3 reference images.

**Endpoint:** `POST /v1/video:batchAsyncGenerateVideoReferenceImages`

**Payload:**
```json
{
  "clientContext": { ... },
  "requests": [{
    "aspectRatio": "VIDEO_ASPECT_RATIO_LANDSCAPE",
    "seed": 12345,
    "textInput": {
      "prompt": "Scene description"
    },
    "referenceInput": {
      "references": [
        { "mediaId": "CAMaJD..." },
        { "mediaId": "CAMaJD..." },
        { "mediaId": "CAMaJD..." }
      ]
    },
    "videoModelKey": "veo_3_0_r2v_fast_ultra",
    "metadata": {
      "sceneId": "uuid"
    }
  }]
}
```

---

## Paygate Tiers

| Tier | Description | Access |
|------|-------------|--------|
| `PAYGATE_TIER_ONE` | Basic tier | Free accounts |
| `PAYGATE_TIER_TWO` | Premium tier | Google One AI Premium / Ultra |

---

## Credit Costs

| Operation | Quality Model | Fast Model | Lower Priority |
|-----------|---------------|------------|----------------|
| Text-to-Video | 100 credits | 10 credits | Free |
| Frames-to-Video | 100 credits | 10 credits | Free |
| Ingredients-to-Video | - | 10-20 credits | Free |
| Video Extension | 100 credits | 10-20 credits | Free |
| Upscaling 4K | 50 credits | - | - |
| Object Insert/Remove | - | 20 credits | - |

---

## User Settings API

### Get User Settings

**Endpoint:** `GET /fx/api/trpc/videoFx.getUserSettings`

**Response:**
```json
{
  "result": {
    "data": {
      "json": {
        "result": {
          "lastSelectedVideoModelKey": "veo_3_1_t2v",
          "lastSelectedVideoAspectRatio": "VIDEO_ASPECT_RATIO_LANDSCAPE",
          "lastAcknowledgedChangeLogId": "...",
          "dismissedBannerIds": [...]
        }
      }
    }
  }
}
```

### Set Video Model Key

**Endpoint:** `POST /fx/api/trpc/videoFx.setLastSelectedVideoModelKey`

**Payload:**
```json
{
  "json": {
    "videoModelKey": "veo_3_1_t2v"
  }
}
```

### Set Aspect Ratio

**Endpoint:** `POST /fx/api/trpc/videoFx.setLastSelectedVideoAspectRatio`

**Payload:**
```json
{
  "json": {
    "aspectRatio": "VIDEO_ASPECT_RATIO_LANDSCAPE"
  }
}
```

---

## Video Generation Status

### Status Values

| Status | Description |
|--------|-------------|
| `MEDIA_GENERATION_STATUS_PENDING` | Generation queued |
| `MEDIA_GENERATION_STATUS_PROCESSING` | Currently generating |
| `MEDIA_GENERATION_STATUS_SUCCESSFUL` | Generation complete |
| `MEDIA_GENERATION_STATUS_FAILED` | Generation failed |

### Polling for Status

**Endpoint:** `POST /v1/video:batchCheckAsyncVideoGenerationStatus`

**Payload:**
```json
{
  "operationIds": ["operation-id-1", "operation-id-2"]
}
```

**Response:**
```json
{
  "operations": [
    {
      "operationId": "...",
      "status": "MEDIA_GENERATION_STATUS_SUCCESSFUL",
      "fifeUrl": "https://...",
      "metadata": {
        "sceneId": "uuid"
      }
    }
  ]
}
```

---

## Model Selection Logic

### For Text-to-Video

1. Use the model key from user's `lastSelectedVideoModelKey`
2. Match the aspect ratio with `lastSelectedVideoAspectRatio`
3. Filter by `VIDEO_MODEL_CAPABILITY_TEXT`

### For Image-to-Video (I2V)

1. Use `veo_3_1_i2v_s` for landscape or `veo_3_1_i2v_s_portrait` for portrait
2. Or use fast variants: `veo_3_1_i2v_s_fast_ultra` / `veo_3_1_i2v_s_fast_portrait_ultra`
3. Filter by `VIDEO_MODEL_CAPABILITY_START_IMAGE`

### For Frames-to-Video (I2V-FL)

1. Use `veo_3_1_i2v_s_fl` for landscape or `veo_3_1_i2v_s_portrait_fl` for portrait
2. Filter by `VIDEO_MODEL_CAPABILITY_START_IMAGE_AND_END_IMAGE`

### For Ingredients-to-Video (R2V)

1. Use `veo_3_0_r2v_fast_ultra` (landscape only currently)
2. Filter by `VIDEO_MODEL_CAPABILITY_MULTI_REFERENCE_NO_STYLE`

---

## Deprecated Models

The following models have `MODEL_STATUS_DEPRECATED` and should be avoided:

- `veo_3_0_*` (Veo 3.0 series) - Use `veo_3_1_*` instead
- `veo_3_i2v_s_*` - Use `veo_3_1_i2v_s_*` instead
- `veo_2_r2v_*` - Use `veo_3_0_r2v_*` instead
- `veo_2_camera_control` - Deprecated

---

## Generation Time Estimates

| Model Type | Fast | Quality |
|------------|------|---------|
| Text-to-Video | ~100s | ~210s |
| Frames-to-Video | ~120s | ~210s |
| Ingredients-to-Video | ~120s | - |
| Video Extension | ~120s | ~120s |
| Upscaling | ~240s | ~240s |

---

## Rate Limiting

- Recommended delay between prompts: 30 seconds
- Maximum polling attempts: 250 (at 3s intervals = ~12.5 minutes)
- User throttle error: Wait and retry

---

## Error Codes

| Error | Description |
|-------|-------------|
| `INVALID_ARGUMENT` | Bad request payload |
| `PERMISSION_DENIED` | Account tier restriction |
| `RESOURCE_EXHAUSTED` | Rate limited |
| `INTERNAL` | Server error |

---

*Last updated: January 2026*
*Data extracted from Google Labs Flow API*
