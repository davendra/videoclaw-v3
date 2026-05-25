# Subtitle Style Presets

Four ASS (Advanced SubStation Alpha) subtitle presets optimized for UGC video formats.

## ugc-bold

**Visual**: Large white text with thick black outline. Positioned in bottom third. High contrast for readability on any background. The standard "impact text" look common on Instagram Reels.

**Best for**: Talking head videos, hooks, any scene with busy/changing backgrounds.

**ASS Style Line**:
```
Style: UGCBold,Arial,22,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,3,1.5,2,10,10,30,1
```

Breakdown:
- Font: Arial, size 22
- Primary color: White (`&H00FFFFFF`)
- Outline: Black, thickness 3
- Shadow: 1.5px offset
- Alignment: Bottom center (2)
- Margins: L=10, R=10, V=30

**Example appearance**: Bold white "I literally could not believe the difference" centered at bottom, thick black outline ensures legibility over light or dark backgrounds.

---

## ugc-minimal

**Visual**: Smaller white text with subtle drop shadow. Clean, modern look. No heavy outline. Positioned slightly higher than ugc-bold for a less "meme-like" feel.

**Best for**: Product demos, calm/wellness content, premium brand UGC, testimonials.

**ASS Style Line**:
```
Style: UGCMinimal,Helvetica Neue,18,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,0,2,2,15,15,40,1
```

Breakdown:
- Font: Helvetica Neue, size 18
- Primary color: White (`&H00FFFFFF`)
- Outline: None (thickness 0)
- Shadow: Semi-transparent black (`&H64000000`), 2px offset
- Alignment: Bottom center (2)
- Margins: L=15, R=15, V=40

**Example appearance**: Clean white "this changed my entire morning routine" with soft shadow, positioned slightly above bottom edge. Reads as editorial, not social-media-viral.

---

## ugc-tiktok

**Visual**: Word-by-word highlight animation. Active word appears in yellow/accent color while surrounding words remain white. Centered vertically for maximum impact. The signature TikTok/Hormozi caption style.

**Best for**: High-energy hooks, viral content, fitness/motivation, Gen Z targeting, short-form (<30s).

**ASS Style Lines**:
```
; Base text (white, all words visible)
Style: TikTokBase,Montserrat,24,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,3,1,5,10,10,10,1

; Active word highlight (yellow)
Style: TikTokHighlight,Montserrat,24,&H0000FFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,3,1,5,10,10,10,1
```

Breakdown:
- Font: Montserrat Bold, size 24
- Base color: White (`&H00FFFFFF`)
- Highlight color: Yellow (`&H0000FFFF`)
- Outline: Black, thickness 3
- Alignment: Center (5)
- Margins: L=10, R=10, V=10 (centered vertically)

**Implementation note**: Each word gets its own timed subtitle event. The base line shows all words in white; overlapping highlight events color the active word yellow. Requires per-word timing from transcript.

**Example appearance**: Center screen shows "nobody talks about THIS" where "THIS" is bright yellow and surrounding words are white. Each word highlights in sequence as spoken.

---

## ugc-caption

**Visual**: Standard broadcast-style closed captions. White text on semi-transparent black background box. Professional, accessible, ADA-compliant appearance.

**Best for**: Longer-form content (>45s), educational UGC, accessibility-first brands, Facebook (often watched muted), professional/B2B content.

**ASS Style Line**:
```
Style: UGCCaption,Arial,16,&H00FFFFFF,&H000000FF,&H80000000,&H00000000,0,0,0,0,100,100,0,0,3,0,0,2,10,10,25,1
```

Breakdown:
- Font: Arial, size 16
- Primary color: White (`&H00FFFFFF`)
- Background box: Semi-transparent black (`&H80000000`)
- Border style: 3 (opaque box behind text)
- Outline: None
- Alignment: Bottom center (2)
- Margins: L=10, R=10, V=25

**Example appearance**: White text "here is what I learned after 30 days" on a dark semi-transparent rectangular background strip at the bottom of the frame. Clean, readable, TV-caption aesthetic.

---

## Preset Comparison

| Preset | Energy | Readability | Platform Fit | Typical Content |
|--------|--------|-------------|-------------|-----------------|
| ugc-bold | High | Excellent | IG Reels, YouTube Shorts | Hooks, reactions, reveals |
| ugc-minimal | Low | Good (on dark BGs) | IG Stories, premium brands | Demos, wellness, luxury |
| ugc-tiktok | Very High | Excellent | TikTok, YouTube Shorts | Viral, motivational, fast-paced |
| ugc-caption | Neutral | Excellent | Facebook, LinkedIn, YouTube | Educational, long-form, accessible |

## Usage in Pipeline

Specify the subtitle preset when generating subtitles:

```bash
python skills/ugc/scripts/generate_subtitles.py \
  --transcript "projects/{slug}/audio/tts/transcript.json" \
  --style ugc-bold \
  --output "projects/{slug}/subtitles/scene_{N}.ass"
```

Override colors per-brand:
```bash
--accent-color "#FF6B35"  # Custom highlight color for ugc-tiktok
--font "Inter"            # Override default font
```
