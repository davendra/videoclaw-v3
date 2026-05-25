# Negative Prompts Reference

Negative prompts tell AI models what to **avoid** in generated content. Use these consistently across all image and video generation.

## Standard Negative Prompt

Use for most generations:
```
no text, no logos, no watermarks, clean plate
```

## Extended Negative Prompt

Use for high-quality hero shots or close-ups:
```
no text, no logos, no watermarks, clean plate, no artifacts, sharp focus, no blur, no distortion
```

## Video-Specific Negative Prompt

Add these for video generation (Flow/Veo):
```
no text, no logos, no watermarks, clean plate, no jitter, no flickering, smooth motion, no morphing artifacts
```

## Product Photography Negative Prompt

For product shots and marketing images:
```
no text, no logos, no watermarks, clean plate, no reflections on product, no harsh shadows, no background distractions
```

## Portrait/Character Negative Prompt

For character and people shots:
```
no text, no logos, no watermarks, clean plate, no extra limbs, no distorted faces, no unnatural poses, anatomically correct
```

## When to Use Each

| Use Case | Negative Prompt |
|----------|-----------------|
| Quick test generation | Standard |
| Final hero images | Extended |
| Video scenes | Video-Specific |
| Product marketing | Product Photography |
| Character consistency | Portrait/Character |

## Implementation

### In Python Scripts

```python
STANDARD_NEGATIVE = "no text, no logos, no watermarks, clean plate"
EXTENDED_NEGATIVE = f"{STANDARD_NEGATIVE}, no artifacts, sharp focus, no blur"
VIDEO_NEGATIVE = f"{STANDARD_NEGATIVE}, no jitter, no flickering, smooth motion"
```

### In Go Bananas MCP

```json
{
  "negative_prompt": "no text, no logos, no watermarks, clean plate"
}
```

### In Flow Video Generator

Negative prompts are applied via the scene prompt itself - append to the main prompt:
```
[scene description]. No text, no logos, no watermarks.
```

## Common Issues Without Negative Prompts

- **Text appearing**: AI may add random text/labels to images
- **Watermarks**: Some models add subtle watermarks by default
- **Logo artifacts**: Brand-like shapes may appear in compositions
- **Motion blur**: Videos may have excessive blur without guidance
- **Morphing**: Character features may shift between frames
