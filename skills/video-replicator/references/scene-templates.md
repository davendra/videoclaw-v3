# Scene Templates for CREATE Mode

Pre-built scene structures for common video types. Use these as starting points in CREATE mode.

## Product Ad (4 scenes, 15-30s)

Classic product showcase structure optimized for conversions.

### Structure

| Scene | Type | Duration | Purpose |
|-------|------|----------|---------|
| 1 | Hero Shot | 3-4s | Dramatic product introduction |
| 2 | Lifestyle | 4-5s | Product in real-world context |
| 3 | Interaction | 4-5s | Model/character using product |
| 4 | Final | 3-4s | Logo-safe closing shot |

### Scene Details

**Scene 1: Hero Shot**
```json
{
  "environment": {
    "setting": "minimalist studio, solid color backdrop",
    "depth_layers": {"foreground": "empty", "midground": "product", "background": "gradient/solid"}
  },
  "action": {
    "primary": "product reveal with dramatic lighting",
    "speed": "slow (30%)",
    "keyframes": [
      {"percentage": "0%", "description": "product partially visible/in shadow"},
      {"percentage": "50%", "description": "full product reveal"},
      {"percentage": "100%", "description": "hero position, well-lit"}
    ]
  },
  "lighting": {"setup": "studio", "direction": "rim + key", "quality": "dramatic"},
  "camera": {"shot_type": "close-up", "movement_type": "push_in", "movement_speed": "slow"}
}
```

**Scene 2: Lifestyle**
```json
{
  "environment": {
    "setting": "relevant lifestyle setting (home, office, outdoors)",
    "depth_layers": {"foreground": "contextual props", "midground": "product in use", "background": "environment"}
  },
  "action": {
    "primary": "product integrated into daily life",
    "speed": "medium (50%)",
    "keyframes": [
      {"percentage": "0%", "description": "establish setting"},
      {"percentage": "50%", "description": "product visible in context"},
      {"percentage": "100%", "description": "benefit demonstrated"}
    ]
  },
  "lighting": {"setup": "natural", "direction": "window/ambient", "quality": "soft, inviting"},
  "camera": {"shot_type": "medium-wide", "movement_type": "dolly", "movement_speed": "medium"}
}
```

**Scene 3: Interaction**
```json
{
  "environment": {
    "setting": "same as scene 2 or complementary",
    "depth_layers": {"foreground": "hands/product", "midground": "model", "background": "soft focus"}
  },
  "action": {
    "primary": "model interacts with product naturally",
    "secondary": ["examining product", "appreciating features"],
    "speed": "medium (50%)",
    "keyframes": [
      {"percentage": "0%", "description": "model reaches for product"},
      {"percentage": "50%", "description": "product interaction peak"},
      {"percentage": "100%", "description": "satisfied expression"}
    ]
  },
  "lighting": {"setup": "mixed", "direction": "3-point", "quality": "flattering"},
  "camera": {"shot_type": "medium", "movement_type": "tracking", "movement_speed": "matches subject"}
}
```

**Scene 4: Final**
```json
{
  "environment": {
    "setting": "clean studio or on-brand environment",
    "depth_layers": {"foreground": "product", "midground": "empty", "background": "brand colors"}
  },
  "action": {
    "primary": "static product display",
    "speed": "minimal",
    "keyframes": [
      {"percentage": "0%", "description": "product positioned"},
      {"percentage": "100%", "description": "logo/CTA space reserved"}
    ]
  },
  "lighting": {"setup": "studio", "direction": "even", "quality": "clean, commercial"},
  "camera": {"shot_type": "wide", "movement_type": "static", "movement_speed": "none"}
}
```

---

## Fashion/Lifestyle (5 scenes, 30-45s)

Model-focused content with outfit reveals and styled poses.

### Structure

| Scene | Type | Duration | Purpose |
|-------|------|----------|---------|
| 1 | Establishing | 3-4s | Location reveal |
| 2 | Entrance | 5-6s | Model enters scene |
| 3 | Detail | 4-5s | Outfit/accessory close-ups |
| 4 | Hero Pose | 6-8s | Confident styled moment |
| 5 | Exit | 4-5s | Graceful departure |

### Scene Details

**Scene 1: Establishing**
```json
{
  "environment": {
    "setting": "aspirational location (beach, rooftop, urban, nature)",
    "depth_layers": {"foreground": "environmental element", "midground": "empty", "background": "location vista"}
  },
  "action": {
    "primary": "camera reveals location",
    "speed": "slow (25%)",
    "keyframes": [
      {"percentage": "0%", "description": "tight on detail"},
      {"percentage": "100%", "description": "wide location reveal"}
    ]
  },
  "lighting": {"setup": "golden_hour or natural", "quality": "atmospheric, moody"},
  "camera": {"shot_type": "wide", "movement_type": "pan or crane", "movement_speed": "slow, cinematic"}
}
```

**Scene 2: Entrance**
```json
{
  "environment": {
    "setting": "continuation of scene 1",
    "depth_layers": {"foreground": "empty", "midground": "model path", "background": "location"}
  },
  "action": {
    "primary": "model walks into frame confidently",
    "secondary": ["natural arm swing", "hair movement"],
    "speed": "medium (40%)",
    "keyframes": [
      {"percentage": "0%", "description": "model enters frame edge"},
      {"percentage": "50%", "description": "full body visible, mid-stride"},
      {"percentage": "100%", "description": "positioned for next scene"}
    ]
  },
  "micromotion": {"fabric": "outfit moves naturally", "hair": "catches wind/movement"},
  "lighting": {"setup": "natural backlit", "quality": "rim light on model"},
  "camera": {"shot_type": "full body", "movement_type": "tracking", "movement_speed": "matches walk"}
}
```

**Scene 3: Detail**
```json
{
  "environment": {
    "setting": "same location, tighter framing",
    "depth_layers": {"foreground": "outfit detail", "midground": "model torso", "background": "soft bokeh"}
  },
  "action": {
    "primary": "showcase outfit details",
    "secondary": ["hand touches fabric", "adjust accessory"],
    "speed": "slow (30%)",
    "keyframes": [
      {"percentage": "0%", "description": "first detail (shoes/bag)"},
      {"percentage": "50%", "description": "transition"},
      {"percentage": "100%", "description": "second detail (jewelry/texture)"}
    ]
  },
  "lighting": {"setup": "directional", "quality": "reveals texture and material"},
  "camera": {"shot_type": "close-up", "movement_type": "static or subtle push", "focus": "rack focus between details"}
}
```

**Scene 4: Hero Pose**
```json
{
  "environment": {
    "setting": "best angle of location",
    "depth_layers": {"foreground": "empty", "midground": "model centered", "background": "aspirational backdrop"}
  },
  "action": {
    "primary": "model strikes confident pose",
    "secondary": ["weight shift", "gaze direction"],
    "speed": "slow (20%)",
    "keyframes": [
      {"percentage": "0%", "description": "natural standing"},
      {"percentage": "50%", "description": "pose develops"},
      {"percentage": "100%", "description": "hero pose held"}
    ]
  },
  "lighting": {"setup": "golden_hour", "quality": "warm, flattering, rim light"},
  "camera": {"shot_type": "medium", "movement_type": "orbit", "movement_speed": "very slow arc"}
}
```

**Scene 5: Exit**
```json
{
  "environment": {
    "setting": "opening up to wider view",
    "depth_layers": {"foreground": "model walking away", "background": "location expanding"}
  },
  "action": {
    "primary": "model walks away from camera",
    "secondary": ["confident stride", "optional look back"],
    "speed": "medium (45%)",
    "keyframes": [
      {"percentage": "0%", "description": "begins to turn"},
      {"percentage": "50%", "description": "walking away, mid-frame"},
      {"percentage": "100%", "description": "distant or frame exit"}
    ]
  },
  "lighting": {"setup": "silhouette or backlit", "quality": "dramatic"},
  "camera": {"shot_type": "wide", "movement_type": "pull out or static", "movement_speed": "slow"}
}
```

---

## Brand Story (6 scenes, 45-60s)

Narrative-driven content with emotional arc.

### Structure

| Scene | Type | Duration | Purpose |
|-------|------|----------|---------|
| 1 | Hook | 3-5s | Attention-grabbing opening |
| 2 | Context | 6-8s | Establish situation/problem |
| 3 | Introduction | 6-8s | Introduce protagonist/product |
| 4 | Action | 8-10s | Core transformation/action |
| 5 | Result | 6-8s | Show outcome/benefit |
| 6 | CTA | 4-5s | Call to action moment |

### Scene Details

**Scene 1: Hook**
```json
{
  "environment": {
    "setting": "intriguing or unexpected visual",
    "atmosphere": "builds curiosity"
  },
  "action": {
    "primary": "immediate visual hook",
    "speed": "fast or dramatic reveal",
    "keyframes": [
      {"percentage": "0%", "description": "striking opening frame"},
      {"percentage": "100%", "description": "question raised"}
    ]
  },
  "lighting": {"setup": "dramatic", "quality": "high contrast, cinematic"},
  "camera": {"shot_type": "varies", "movement_type": "crane or dramatic", "movement_speed": "dynamic"}
}
```

**Scene 2: Context**
```json
{
  "environment": {
    "setting": "relatable everyday environment",
    "atmosphere": "authentic, real"
  },
  "action": {
    "primary": "establish the situation or challenge",
    "speed": "natural (50%)",
    "keyframes": [
      {"percentage": "0%", "description": "situation presented"},
      {"percentage": "50%", "description": "challenge evident"},
      {"percentage": "100%", "description": "need established"}
    ]
  },
  "lighting": {"setup": "natural or realistic", "quality": "documentary feel"},
  "camera": {"shot_type": "medium-wide", "movement_type": "observational", "movement_speed": "steady"}
}
```

**Scene 3: Introduction**
```json
{
  "environment": {
    "setting": "same as context or transition to new space"
  },
  "action": {
    "primary": "protagonist/solution enters",
    "secondary": ["moment of recognition", "curiosity"],
    "speed": "building (40%)",
    "keyframes": [
      {"percentage": "0%", "description": "introduction moment"},
      {"percentage": "50%", "description": "connection forming"},
      {"percentage": "100%", "description": "engagement begins"}
    ]
  },
  "lighting": {"setup": "transitioning", "quality": "brightening, hopeful"},
  "camera": {"shot_type": "medium", "movement_type": "push_in", "movement_speed": "gradual"}
}
```

**Scene 4: Action**
```json
{
  "environment": {
    "setting": "action-appropriate environment"
  },
  "action": {
    "primary": "core transformation or experience",
    "secondary": ["emotional beats", "product interaction"],
    "speed": "dynamic (60%)",
    "keyframes": [
      {"percentage": "0%", "description": "action begins"},
      {"percentage": "33%", "description": "momentum builds"},
      {"percentage": "66%", "description": "peak moment"},
      {"percentage": "100%", "description": "transformation visible"}
    ]
  },
  "lighting": {"setup": "dynamic", "quality": "energetic, follows action"},
  "camera": {"shot_type": "mixed", "movement_type": "tracking/dynamic", "movement_speed": "matches energy"}
}
```

**Scene 5: Result**
```json
{
  "environment": {
    "setting": "transformed or improved environment"
  },
  "action": {
    "primary": "showcase positive outcome",
    "secondary": ["satisfaction", "joy", "relief"],
    "speed": "settling (35%)",
    "keyframes": [
      {"percentage": "0%", "description": "result revealed"},
      {"percentage": "50%", "description": "benefit experienced"},
      {"percentage": "100%", "description": "emotional payoff"}
    ]
  },
  "lighting": {"setup": "uplifting", "quality": "bright, warm, positive"},
  "camera": {"shot_type": "medium", "movement_type": "orbit or gentle push", "movement_speed": "slow, celebratory"}
}
```

**Scene 6: CTA**
```json
{
  "environment": {
    "setting": "clean, brand-appropriate",
    "atmosphere": "professional, actionable"
  },
  "action": {
    "primary": "implied call to action",
    "speed": "resolving (25%)",
    "keyframes": [
      {"percentage": "0%", "description": "settling into final composition"},
      {"percentage": "100%", "description": "CTA/logo space ready"}
    ]
  },
  "lighting": {"setup": "clean studio", "quality": "commercial, polished"},
  "camera": {"shot_type": "wide", "movement_type": "static or gentle settle", "movement_speed": "minimal"}
}
```

---

## Social Reel (3 scenes, 15s)

Fast-paced vertical content for maximum engagement.

### Structure

| Scene | Type | Duration | Purpose |
|-------|------|----------|---------|
| 1 | Hook | 1-2s | Scroll-stopper |
| 2 | Content | 8-10s | Main message/showcase |
| 3 | Payoff | 3-4s | Satisfying conclusion |

### Scene Details

**Scene 1: Scroll-Stopper**
```json
{
  "format": "9:16 portrait",
  "environment": {
    "setting": "visually striking, immediate impact"
  },
  "action": {
    "primary": "immediate attention grab",
    "speed": "instant impact",
    "keyframes": [
      {"percentage": "0%", "description": "eye-catching element"},
      {"percentage": "100%", "description": "curiosity triggered"}
    ]
  },
  "lighting": {"setup": "punchy", "quality": "high contrast, vibrant"},
  "camera": {"shot_type": "close-up or striking angle", "movement_type": "quick zoom or static", "movement_speed": "fast"}
}
```

**Scene 2: Content**
```json
{
  "format": "9:16 portrait",
  "environment": {
    "setting": "relevant to message, vertical-optimized"
  },
  "action": {
    "primary": "deliver main content/message",
    "secondary": ["trending movements", "engaging actions"],
    "speed": "dynamic (55%)",
    "keyframes": [
      {"percentage": "0%", "description": "content begins"},
      {"percentage": "50%", "description": "key information/moment"},
      {"percentage": "100%", "description": "message delivered"}
    ]
  },
  "lighting": {"setup": "trendy", "quality": "ring light or natural bright"},
  "camera": {"shot_type": "medium vertical", "movement_type": "handheld or gimbal", "movement_speed": "dynamic but controlled"}
}
```

**Scene 3: Payoff**
```json
{
  "format": "9:16 portrait",
  "environment": {
    "setting": "conclusion-appropriate"
  },
  "action": {
    "primary": "satisfying resolution or reveal",
    "speed": "impactful (varies)",
    "keyframes": [
      {"percentage": "0%", "description": "build to payoff"},
      {"percentage": "100%", "description": "satisfying conclusion"}
    ]
  },
  "lighting": {"setup": "dynamic", "quality": "follows energy of reveal"},
  "camera": {"shot_type": "varies for impact", "movement_type": "zoom or reveal", "movement_speed": "matches payoff energy"}
}
```

---

## Motion Patterns Reference

### Walking Motions
```
Profile walk (left-to-right): "walks slowly in profile view (30% pace), natural arm swing"
Toward camera: "walks toward camera, growing larger in frame"
Away from camera: "walks away from camera, diminishing in frame"
Diagonal: "walks at 45-degree angle across frame"
```

### Camera Movements
```
Push in: "camera dollies forward slowly, intensifying focus"
Pull out: "camera dollies backward, revealing environment"
Pan: "camera pans horizontally, following action or revealing space"
Orbit: "camera arcs slowly around subject (15-30 degrees)"
Track: "camera tracks parallel to moving subject, maintaining framing"
Crane: "camera moves vertically, revealing or establishing"
Handheld: "subtle organic movement, documentary feel"
```

### Transitions
```
Cut: "hard cut between scenes"
Dissolve: "gradual blend between scenes"
Whip pan: "fast pan creating motion blur transition"
Match cut: "matching composition or movement between scenes"
```

---

## Usage in CREATE Mode

1. **Select video type** - determines default structure
2. **Customize scenes** - adjust any scene to your needs
3. **Add assets** - characters and products are woven in
4. **Generate SEALCAM+** - wizard outputs compatible JSON

Example command:
```bash
python scripts/create_wizard.py \
  --project "summer-collection" \
  --output "projects/summer-collection/analysis/sealcam_analysis.json"
```
