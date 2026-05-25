# Post-Production — what happens AFTER the render

The pipeline produces the stitched final. From there, you may want to:
- Verify quality
- Create platform variants (9:16 crop, 1:1 square)
- Generate a thumbnail
- Upload to YouTube / TikTok / Instagram
- Archive the project

This doc is the playbook.

## 1. Quality Verification

Before sharing, confirm:

### Duration matches target
```bash
ffprobe -v error -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 \
  final/*-narrated-fixed.mp4
```
If off by >30s, check for dropped clips in the log.

### Audio present
```bash
ffprobe -v error -select_streams a -show_entries stream=codec_name \
  -of default=noprint_wrappers=1:nokey=1 \
  final/*-narrated-fixed.mp4
```
Expect `aac`. If empty, narration/music mix failed.

### Resolution + frame rate
```bash
ffprobe -v error -select_streams v -show_entries stream=width,height,r_frame_rate \
  -of default=noprint_wrappers=1:nokey=1 \
  final/*-narrated-fixed.mp4
```
Seedance default: 1920x1080 @ 24fps (cinematic).

### Spot-check keyframes for character consistency
Extract one frame per clip:
```bash
cd <root>/projects/<slug>/videos
for f in clip_*.mp4; do
  ffmpeg -y -i "$f" -ss 0.5 -frames:v 1 "../keyframes/${f%.mp4}.jpg" 2>/dev/null
done
```
Open keyframes/ and visually scan. Same character should look the same across all frames.

## 2. Platform Variants

### Vertical crop (9:16 for TikTok / Shorts / Reels)

Center-crop + scale:
```bash
ffmpeg -y -i final/narrated-fixed.mp4 \
  -vf "crop=ih*9/16:ih,scale=1080:1920" \
  -c:a copy \
  final/vertical-9x16.mp4
```

Or pillar-box (subject stays 16:9 with blurred top/bottom):
```bash
ffmpeg -y -i final/narrated-fixed.mp4 \
  -filter_complex "[0:v]scale=1080:-2,crop=1080:1920:0:(ih-1920)/2[fg];[0:v]scale=1080:1920,boxblur=30:10[bg];[bg][fg]overlay" \
  -c:a copy \
  final/vertical-pillar.mp4
```

### Square (1:1 for Instagram feed)

```bash
ffmpeg -y -i final/narrated-fixed.mp4 \
  -vf "crop=ih:ih,scale=1080:1080" \
  -c:a copy \
  final/square.mp4
```

### Loop-friendly (for social)

Reverse-loop trick for autoplay without obvious restart:
```bash
ffmpeg -y -i final/narrated-fixed.mp4 \
  -filter_complex "[0:v]reverse[r];[0:v][r]concat=n=2:v=1[out]" \
  -map "[out]" -an \
  final/loop.mp4
```

### Trailer / teaser (30s cut from 3:30 final)

Manual pick 3 best beats (usually beats 1, 7, 14), edit in any NLE, export 30s at 9:16.

## 3. Thumbnail Generation

### From a key clip's best frame

```bash
# Pick the most compelling clip (usually the climax, clip_10 or clip_12)
ffmpeg -y -i videos/clip_10.mp4 \
  -ss 6 -frames:v 1 -q:v 2 \
  thumbnail-raw.jpg
```

### Stylize with text overlay

Using ImageMagick:
```bash
convert thumbnail-raw.jpg \
  -resize 1280x720^ -gravity center -extent 1280x720 \
  -font "Impact" -pointsize 90 -fill white -stroke black -strokewidth 4 \
  -gravity south -annotate +0+40 "KOMO: JADE CIPHER" \
  thumbnail.jpg
```

### Or use the `youtube-thumbnail-design` skill (if available)

Follows YouTube best practices (high contrast, mobile-readable, ~20% text coverage).

## 4. Upload Workflows

### YouTube (via `youtube-uploader` skill)

Use the `youtube-uploader` skill or equivalent native upload flow for first-time OAuth setup and publishing:
```bash
# Example handoff payload for an uploader workflow
youtube-uploader \
  --file final/narrated-fixed.mp4 \
  --title "Komo: Jade Cipher — Neo-Tokyo Action Thriller" \
  --description "$(cat descriptions/komo.txt)" \
  --tags "short film,action thriller,neo-tokyo,AI video" \
  --privacy unlisted
```

Best practices:
- Title < 60 chars (mobile truncation)
- Description first 2 lines hook (above-fold)
- 5–15 tags, genre + style + character names
- Custom thumbnail (don't rely on auto-pick)
- End screen for next video suggestion

### TikTok

No stable upload API (requires manual via app, or Business API for approved accounts). Workflow:
1. AirDrop / Dropbox sync `vertical-9x16.mp4` to phone
2. Open TikTok → Upload → add caption + hashtags in-app
3. Avoid bottom 15% (UI overlay zone)

### Instagram Reels

Similar to TikTok — no public upload API.

### LinkedIn

Video upload via LinkedIn mobile or browser. Native upload preferred over YouTube embed for algorithmic reach. Max 15 min / 5GB.

## 5. Archiving

After upload, archive the project:

```bash
cd <root>/projects
tar -czf archives/komo-thriller-$(date +%Y%m%d).tar.gz \
  story-fourteen-komo-jade-cipher-neo-toky/
```

Then (optionally) delete the working dir to save disk:
```bash
# SAFETY: verify archive extracts correctly first!
tar -tzf archives/komo-thriller-*.tar.gz | head -5
rm -rf story-fourteen-komo-jade-cipher-neo-toky/
```

### What to archive
- `final/` — all finals
- `videos/` — individual clips (for re-editing)
- `storyboard.md` — for reference
- `seedance_queue.json` + `images/manifests/` — for replay
- `telemetry/` — run diagnostics

### What to skip
- `images/clip_*_lastframe.jpg` — regeneratable from clips
- `audio/` temp files — usually already baked into finals

## 6. Analytics + Iteration

Once published, track:
- First-24h retention (hook + pacing signal)
- Click-through rate on thumbnail
- Average view duration (storyboard flow signal)
- Drop-off points (specific scene weakness)

If drop-off is clustered at scene N, re-visit that beat's prose and regenerate storyboard. Iteration is cheap; full re-render only if you change ≥3 scenes.

## 7. Repurposing

Your 3:30 movie can spawn:
- **30s teaser** — first 2 scenes + climax + resolution
- **Hook reel** — first 5 seconds + title card
- **Character spotlight** — clips mentioning each character, concatenated
- **Motion GIF** — 5-10s loop for social posts
- **Behind-the-scenes** — storyboard.md + character descriptions as a "making of" post

## 8. Cost-Per-Minute Reality Check

Typical AI video economics:

| Output | Runtime | Cost | Cost/min |
|---|---|---|---|
| 1 short thriller | 3:30 | ~$6 | ~$1.71 |
| 1 UGC ad | 1:30 | ~$2.65 | ~$1.77 |
| 1 storybook | 3:00 | ~$5 | ~$1.67 |
| 1 music video | 2:48 | ~$4.60 | ~$1.64 |

Rough: **$1.50–$2.00 per minute** of finished video, excluding TTS/music/your time.

For 60 mins/month output: ~$100/mo — cheaper than freelancer rates, iterable near-instantly, but pre-production time matters (20–60 min interview + review).

## 9. Legal + Ethics Notes

- **Generated faces.** Seedance's reference_images mode respects your character refs but may still produce "almost-realistic people". Consider style-biasing to be unmistakably stylized (Miyazaki, Wes Anderson) for content that renders humans.
- **Voice cloning.** ElevenLabs TTS can clone voices. Only clone voices you own or have permission for.
- **Music rights.** Suno AI generates royalty-free-ish music, but read their current terms. For commercial use, consider licensed libraries (Artlist, Epidemic).
- **Attribution.** No legal requirement, but common practice: mention AI generation somewhere in description (e.g. "Generated with VideoClaw / Seedance AI").
- **Platform content policies.** YouTube/TikTok increasingly require disclosure for synthetic media. Check current policy.
