# Pacing Guide Reference

Maps Q4 (duration × pacing) to scene count, quality flags, and backend recommendations.

## Duration × Pace → Scene Count

| Duration | Slow Pace | Medium Pace | Fast Pace |
|----------|-----------|-------------|-----------|
| 15s      | 3 scenes  | 4 scenes    | 5 scenes  |
| 30s      | 4 scenes  | 6 scenes    | 8 scenes  |
| 45s      | 6 scenes  | 9 scenes    | 12 scenes |
| 60s      | 8 scenes  | 12 scenes   | 16 scenes |
| 90s      | 10 scenes | 15 scenes   | 20 scenes |

**Rule**: Each Veo/Seedance generation = ~8s. Total time ≈ scenes × 8s (before stitch trim).

## Quality Selection Heuristic

| Situation | Quality Flag | Reason |
|-----------|-------------|--------|
| First draft / testing | `--quality fast` | 10 credits, ~90s — iterate quickly |
| Dynamic/social content | `--quality fast` | Energy reads well at fast quality |
| Product hero shots | `--quality quality` | Details matter |
| Presenter/talking head | `--quality fast` | Seedance audio-lipsync is fast-only |
| Final deliverable | `--quality quality` | 100 credits, ~3.5min |
| Budget constraint | `--quality free` | 0 credits, ~90s (Veo direct only) |

## Backend vs Duration

| Duration | Recommended Backend | Why |
|----------|---------------------|-----|
| ≤ 30s | `useapi` | Simple, reliable, cost-effective |
| 30-60s | `seedance` (omni) | Better narrative structure via omni_reference |
| 60s+ | `seedance` (omni, chained) | Multi-segment with `seedance_omni.py` |
| Continuous extension | `useapi` (extend_chain) | `extend_chain.py` for seamless loops |

## Scene Duration Budget

- Veo/Seedance generated clip: ~8s raw
- After stitch trim: ~6-7s effective per scene
- Target: leave ~0.5s overlap for smooth transitions
- For `--chained` mode: plan for 1s overlap between scenes (auto-handled)

## Parallel Generation

For 8+ scenes, use `--parallel 3` to run 3 scenes concurrently:
```bash
python scripts/parallel_video_gen.py \
  --product "{slug}" \
  --parallel 3 \
  --scenes '{"1":"...","2":"...","3":"...","4":"...","5":"...","6":"...","7":"...","8":"..."}' \
  --quality fast --yes
```
Cost: same credits, ~3× faster wall time.
