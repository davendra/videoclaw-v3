# Character Reference Prompts Guide

When using Go Bananas character references (`character_id`), prompts must be simplified to let the reference handle appearance.

## The Rule

> **When character_id is provided, describe WHAT they do, not WHO they are.**

The character reference handles the face and body. Your prompt should focus on **pose, action, environment** only.

## What to Include vs Exclude

| Include | Exclude |
|---------|---------|
| Pose, gesture | Character name |
| Action, movement | "Warm smile", "confident expression" |
| Environment, setting | Age ("young", "30 years old") |
| Clothing description | Hair color/style |
| Lighting, mood | Body type, skin tone |
| Camera angle, composition | Facial features |
| Props, objects | Personality descriptors |
| Style tokens (cinematic, 8K) | Ethnicity descriptors |

## Why This Happens

Go Bananas uses Gemini's image model which weighs text prompts heavily. When you describe a face ("warm smile", "confident expression"), the model generates that face from scratch rather than using your reference.

The `character_id` provides the face. Your prompt provides the scene.

## Examples

### Scene: Greeting in Desert

**Over-described (character ignored):**
```
Ram Patel, warm genuine smile, greeting gesture with hands together
in namaste. Young confident Indian man with dark hair. Desert setting
with soft warm lighting. Friendly, welcoming expression.
```

**Action-focused (character followed):**
```
Man doing namaste greeting gesture. Desert sand dunes background with
warm golden lighting. Black traditional kurta. Medium shot, cinematic 8K.
```

### Scene: Adjusting Sunglasses

**Over-described:**
```
Ram Patel adjusting stylish sunglasses with one hand, cool confident pose.
Handsome young man with striking features.
```

**Action-focused:**
```
Man adjusting sunglasses with one hand, confident pose. Desert mountains
background with rose petals floating. Black modern outfit. Fashion photography.
```

### Scene: Walking Through Alley

**Over-described:**
```
Ram Patel walking through traditional Middle Eastern alleyway. Young Indian
man with arms outstretched in celebratory gesture. Athletic build.
```

**Action-focused:**
```
Man walking through Middle Eastern alleyway with mud brick buildings.
Arms outstretched in celebration. Black kurta. Warm terracotta walls,
filtered natural light. Cultural cinematic 8K portrait.
```

### Scene: Family Portrait

**Over-described:**
```
Ram Patel standing with family, warm fatherly smile, protective stance.
50 year old Indian man, distinguished features, graying at temples.
```

**Action-focused:**
```
Man standing in protective stance with family. Snowy winter setting.
Formal black coat. Warm family composition. Portrait lighting.
Medium-wide shot, cinematic.
```

## Pattern Detection

These patterns in your prompt will likely override the character reference:

| Pattern | Example | Why It's Problematic |
|---------|---------|----------------------|
| **Names** | "Ram Patel", "Sofia" | Model generates from name meaning |
| **Expression words** | "warm smile", "friendly look" | Forces specific facial expression |
| **Age descriptors** | "young", "50 years old" | Changes perceived age |
| **Body descriptions** | "athletic build", "slim" | Overrides reference body |
| **Facial features** | "dark eyes", "strong jaw" | Describes face that ref provides |
| **Personality adjectives** | "confident", "elegant" | Influences facial generation |

## Pose Complexity and Character Drift

Dynamic poses cause the model to "forget" the character reference. When computing complex motion, it generates a generic person matching the action description instead of your character.

### Static vs Dynamic Poses

| Pose Type | Example | Character Adherence |
|-----------|---------|---------------------|
| **Static** | "Standing confidently" | ✓ High |
| **Static** | "Seated at table" | ✓ High |
| **Static** | "Relaxed pose, arms at sides" | ✓ High |
| **Dynamic** | "Walking with powerful stride" | ✗ Low - AVOID |
| **Dynamic** | "Running towards camera" | ✗ Low - AVOID |
| **Dynamic** | "Dynamic jumping pose" | ✗ Low - AVOID |

### Words That Cause Character Drift

| ❌ Avoid | ✅ Use Instead |
|----------|---------------|
| "Walking with powerful stride" | "Standing confidently" |
| "Dynamic walking pose" | "Relaxed standing pose" |
| "Running" | "Standing mid-step" |
| "Jumping" | "Slight crouch" |
| "playful mood" | "sophisticated mood" |
| "energetic" | "composed" |

### Best Practice: Static First Frames

For video generation, use **static poses** for first-frame images. The video prompt handles motion:

**Image prompt (static):**
```
Standing confidently in desert landscape, wearing black traditional Indian dress.
Relaxed pose, arms at sides. Medium shot, facing camera. Cinematic 8K.
```

**Video prompt (handles motion):**
```
Camera: slow dolly in. Subject: begins walking towards camera with natural stride.
Micromotion: fabric sways, subtle weight shift. Smooth continuous motion.
```

This separation ensures:
1. First frame preserves character identity
2. Video animation adds desired motion
3. No character drift between scenes

## Prompt Transformation Checklist

Before generating with `character_id`:

- [ ] No character name in prompt
- [ ] No facial expression descriptions ("smile", "expression", "look")
- [ ] No age/body/hair descriptors
- [ ] No personality words in pose context ("confident", "friendly", "elegant")
- [ ] **No dynamic action words ("walking", "running", "jumping")**
- [ ] **Use static poses ("standing", "seated", "relaxed")**
- [ ] Focus on: pose, environment, clothing, lighting

## MCP Command Format

When using `character_id`, structure your call like this:

```python
mcp__go-bananas__generate_image(
    prompt="Man doing namaste greeting gesture. Desert sand dunes background. "
           "Black traditional kurta. Medium shot, cinematic 8K.",
    character_id=27,
    aspect_ratio="9:16",
    model_id="gemini-pro-image"  # ALWAYS use Pro model
)
```

**NOT this:**

```python
mcp__go-bananas__generate_image(
    prompt="Ram Patel, warm genuine smile, greeting gesture with hands "
           "together in namaste. Young Indian man, confident expression...",
    character_id=27,  # This will be IGNORED due to verbose prompt
    aspect_ratio="9:16",
    model_id="gemini-pro-image"
)
```

## Related Documentation

- `character-variants.md` - Creating age/style variants of characters
- `gobananas-guide.md` - Complete Go Bananas integration guide
- `SKILL.md` Phase 3 - Image generation workflow
