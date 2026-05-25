# UGC Video Prompt Templates for Veo 3

## Core UGC Video Prompt Template

Every UGC Veo prompt should follow this structure:

```
[CAMERA] [CHARACTER] [ACTION] [SETTING] [AESTHETIC] [AUDIO]
```

Base template:
```
Handheld iPhone selfie video. [Character description] [action/dialogue].
Shot in [location]. Natural lighting, slightly overexposed highlights,
casual framing. Authentic UGC aesthetic, not polished or produced.
[Character] speaks directly to camera: "[dialogue]"
```

## Visual Style Types

### UGC Selfie (Talking Head)

Primary format for hooks, mechanisms, CTAs.

```
Handheld selfie-style video shot on iPhone. [Age] [ethnicity] [gender]
with [hair] and [outfit] holds phone at slightly above eye level.
[Character] looks directly into camera lens and speaks naturally:
"[dialogue]". Background is [location]. Natural daylight from [direction],
soft shadows. Slight camera movement from hand-holding. Authentic,
unpolished UGC aesthetic. Phone mic audio quality.
```

Key details:
- Camera slightly above eye level (flattering selfie angle)
- Character looks at LENS, not screen
- Slight natural hand movement (not stabilized)
- Overexposed window light or warm indoor lighting
- No makeup lights, ring lights, or studio setups

### UGC B-Roll (Product/Environment Shots)

Insert shots between talking head segments.

```
Handheld close-up video shot on iPhone. [Product/scene description].
[Camera movement: slow pan across / gentle tilt down / slight zoom in].
Natural lighting, shallow depth of field from phone lens. Slightly shaky
handheld movement. No color grading, authentic phone camera look.
Ambient room sound.
```

Common B-roll types:
- Product unboxing / first touch
- Product in use (applying, pouring, clicking)
- Result/outcome shot (before/after skin, clean desk, meal plated)
- Lifestyle context (morning routine, gym bag, kitchen counter)

### UGC Product Demo

Hands-on demonstration with voiceover.

```
Overhead handheld iPhone video of [hands/surface]. [Character's] hands
[demonstrate action with product]. [Product] clearly visible with
[brand detail]. Natural top-down lighting, kitchen counter/bathroom
vanity/desk surface. Casual framing, fingers occasionally at edge of
frame. Voiceover: "[dialogue]". Ambient background noise.
```

## Character Consistency

When generating multiple scenes with the same UGC creator:

1. **Use Go Bananas character refs** — create character with `model_id="gemini-pro-image"` first
2. **Lock appearance details** in every prompt:
   - Exact hair description (color, length, style)
   - Outfit (keep same across all scenes of one shoot)
   - Distinguishing features (glasses, jewelry, tattoo)
3. **Maintain location** — same background across a "shoot session"
4. **Voice consistency** — use same ElevenLabs voice ID + seed for all TTS

Prompt pattern for consistency:
```
Same woman from previous scenes — early 30s, shoulder-length dark brown
wavy hair, wearing oversized sage green hoodie, small gold hoop earrings.
```

## Accent Specification by Market

Specify accent in the Veo prompt AND match with appropriate ElevenLabs voice.

| Market | Prompt Accent Phrase | Voice Style |
|--------|---------------------|-------------|
| US (General) | "speaks with a standard American accent" | Neutral, warm |
| US (Southern) | "speaks with a slight Southern American accent" | Friendly, unhurried |
| UK | "speaks with a British accent" | Conversational RP or regional |
| Australia | "speaks with an Australian accent" | Relaxed, upward inflection |
| India | "speaks with an Indian English accent" | Clear, measured pace |
| South Africa | "speaks with a South African accent" | Distinct vowels |
| Canada | "speaks with a Canadian accent" | Neutral North American |

**Veo 3 note**: Accent specification in the prompt influences generated speech when using lip-sync mode. For TTS-only workflows, accent is controlled by ElevenLabs voice selection.

## Background Music Specification

Add music direction at the end of Veo prompts:

```
# Upbeat/energetic (beauty, fitness)
Background music: upbeat lo-fi hip hop beat, soft and non-intrusive

# Calm/trust (wellness, finance)
Background music: gentle acoustic guitar, ambient and warm

# Trendy/viral (Gen Z products)
Background music: trending TikTok-style beat, catchy and minimal

# No music (testimonial, serious)
No background music, only ambient room sound
```

**Volume**: Music should sit at 10-15% volume in final mix. Specify in stitch with `--music-volume 0.12`.

## Product Integration in Prompts

### Physical Product
```
[Character] holds [product with specific description — color, size, shape]
in [hand position: left hand at chest height / both hands in front].
[Brand name/logo] faces camera. Product is [sealed/open/in use].
```

### Digital Product / App
```
[Character] holds phone showing [app screen description]. Phone screen
clearly visible, tilted slightly toward camera. [Character] taps/scrolls
with thumb while speaking.
```

### Service
```
[Character] [demonstrates outcome of service]. [Before/after visual cue].
No product in frame — focus on transformation/result.
```

## Location Ideas by Segment

| Segment | Primary Location | Alternative |
|---------|-----------------|-------------|
| Beauty/Skincare | Bathroom mirror, vanity | Bedroom, natural window light |
| Health/Supplements | Kitchen counter | Gym bag, morning routine |
| Fitness | Home gym, living room floor | Park, outdoor workout |
| Food/Beverage | Kitchen island | Dining table, cafe |
| Tech/SaaS | Desk/home office | Coffee shop, couch |
| Fashion | Bedroom, full-length mirror | Closet, entryway |
| Finance | Home office desk | Kitchen table, couch |
| Baby/Parenting | Nursery, living room | Kitchen, car (parked) |

## Common Mistakes to Avoid

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| "Professional studio lighting" | Breaks UGC authenticity | Use "natural lighting" or "window light" |
| "4K cinematic quality" | Looks like an ad, not organic | Use "iPhone camera quality" or "phone footage" |
| Perfect framing/composition | Too polished for UGC | Add "slightly off-center framing" or "casual composition" |
| Character looking off-camera | Breaks direct connection | Specify "looks directly into camera lens" |
| Robotic/scripted delivery | Feels inauthentic | Add "speaks naturally and conversationally" |
| Multiple products in frame | Dilutes focus | One product per scene maximum |
| Brand name in first 3 seconds | Triggers ad-skip reflex | Save brand reveal for mechanism/proof |
| Stabilized smooth camera | Reads as produced content | Add "slight handheld movement" |
| Ring light catch-light in eyes | Screams "influencer ad" | Use "natural daylight" or "overhead room lighting" |
| Over-specifying every detail | Veo gets confused with too many constraints | Keep to 3-4 key visual details per prompt |
