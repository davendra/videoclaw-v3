---
name: youtube-audio
description: Download audio (MP3) or video (MP4) from YouTube. Use when the user wants to download audio, music, sound, or video from YouTube videos or playlists. Supports single videos, playlists, batch URLs, trimming, resolution selection, and quality settings. Can download audio only, video only, or both. Requires yt-dlp and FFmpeg.
---

# YouTube Downloader

Download MP3 audio or MP4 video from YouTube using `yt-dlp` + FFmpeg.

## Quick Start

```bash
# Audio (default)
yt-dlp -x --audio-format mp3 "URL"

# Video
yt-dlp -f "bv*+ba/b" -o "%(title)s.%(ext)s" "URL"

# Both audio + video
yt-dlp -f "bv*+ba/b" -o "%(title)s.%(ext)s" "URL"
yt-dlp -x --audio-format mp3 "URL"
```

## Audio Examples

```bash
# Default 192kbps MP3
yt-dlp -x --audio-format mp3 "URL"

# High quality 320kbps
yt-dlp -x --audio-format mp3 --audio-quality 320K "URL"

# Custom output
yt-dlp -x --audio-format mp3 -P music -o "my-song.%(ext)s" "URL"

# Preview without downloading
yt-dlp --simulate "URL"
```

## Video Examples

```bash
# Best available quality
yt-dlp -f "bv*+ba/b" -o "%(title)s.%(ext)s" "URL"

# Specific resolution
yt-dlp -f "bv*[height<=1080]+ba/b[height<=1080]" "URL"
yt-dlp -f "bv*[height<=2160]+ba/b[height<=2160]" "URL"
yt-dlp -f "bv*[height<=720]+ba/b[height<=720]" "URL"

# Both audio + video files
yt-dlp -f "bv*+ba/b" -P downloads "URL"
yt-dlp -x --audio-format mp3 -P downloads "URL"
```

## Batch Downloads

```bash
# Multiple URLs
yt-dlp -P downloads "URL1" "URL2" "URL3"

# Playlist
yt-dlp -x --audio-format mp3 -P music "https://www.youtube.com/playlist?list=PLAYLIST_ID"

# From a text file (one URL per line, # comments ignored)
yt-dlp -a urls.txt -P downloads
```

## Common Commands

| Task | Command |
|------|---------|
| Audio download | `yt-dlp -x --audio-format mp3 "URL"` |
| Video download | `yt-dlp -f "bv*+ba/b" "URL"` |
| Custom output dir | `yt-dlp -P downloads "URL"` |
| Custom file name | `yt-dlp -o "name.%(ext)s" "URL"` |
| Dry-run metadata | `yt-dlp --simulate "URL"` |
| Batch file | `yt-dlp -a urls.txt -P downloads` |

For precise start/end trims, download first and cut the local file with `ffmpeg`.

## Resolution Aliases

| Input | Resolution |
|-------|-----------|
| `360`, `360p` | 360p |
| `480`, `480p` | 480p |
| `720`, `720p`, `hd` | 720p HD |
| `1080`, `1080p`, `fullhd`, `fhd` | 1080p Full HD |
| `1440`, `1440p`, `2k`, `qhd` | 1440p 2K |
| `2160`, `2160p`, `4k`, `uhd` | 2160p 4K |
| `best` (default) | Highest available |

## Requirements

- `pip install yt-dlp`
- `brew install ffmpeg`
- `brew install deno` (recommended for reliable YouTube extraction)

## Integration with Video Replicator

```bash
# Download reference video for COPY mode analysis
yt-dlp -f "bv*[height<=1080]+ba/b[height<=1080]" \
  -P "projects/{slug}/reference" \
  -o "original.%(ext)s" \
  "URL"

# Download background music for Phase 5
yt-dlp -x --audio-format mp3 --audio-quality 192K \
  -P "projects/{slug}/audio" \
  -o "background.%(ext)s" \
  "URL"
```
