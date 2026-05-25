# Changelog

> Historical reference only. This changelog describes legacy `video-replicator`
> implementation eras and may mention script paths or prompt-db utilities that
> do not exist in `vclaw-video-core`. Treat it as design history, not as a
> runnable command inventory for the clean-room repo.

## v2.41 (2026-02-17) — Seedance Omni v2: Narrative Structure & Voiceover

### New Features
- **Shared client extraction**: `seedance_client.py` — 8 public API functions shared between `seedance_backend.py` and `seedance_omni.py`
- **Narrative segment roles**: intro (no logo) → body (no logo) → outro (logo reveal + tagline)
- **Voiceover support**: `--voiceover` auto-generates tagline via Gemini, TTS via ElevenLabs, bakes onto outro
- **Pipelined generation**: 1-segment lookahead with ThreadPoolExecutor, circuit breaker on 2 consecutive failures
- **Quality fallback**: auto-retries with `seedance_2.0_fast` if `seedance_2.0` unavailable
- **Resume support**: `--resume` reads `omni_progress.json` checkpoint, skips completed segments
- **Enhanced dry-run**: shows role, logo usage, voiceover text, per-segment cost, ETA

### Bug Fixes
- **Cost estimation**: corrected from 36 to 150 credits per omni_reference segment
- **Content moderation**: auto-sanitizes prompt on 2038 error with escalating sanitization levels
- **Duration validation**: retries if actual video duration < 80% of requested

### New Files
- `seedance_client.py` — shared API client
- `docs/plans/2026-02-17-seedance-omni-v2-implementation.md` — implementation plan

### New CLI Flags (seedance_omni.py)
| Flag | Default | Description |
|------|---------|-------------|
| `--voiceover` / `--vo` | off | Enable voiceover |
| `--vo-style` | luxury | Tone preset |
| `--vo-voice` | Rachel | ElevenLabs voice |
| `--vo-text` | auto | Override tagline |
| `--music` | - | Background music |
| `--resume` | off | Resume from checkpoint |

## v2.27 (2026-02-03)

### New Features
- **I2V Backend Abstraction**: New `format_i2v_command()` helper in utils.py abstracts backend differences for image-to-video generation. useapi backend now correctly uses `image:` prefix in prompt text, while direct backend uses `-i` flag.
- **Logo Hold Frame**: `--hold-end N` flag on `generate_logo_animation.py` freezes the final frame for N seconds at the end, ensuring clear logo visibility when animations cut off mid-effect.
- **Scene Mixer**: `--mix "run001:2 run002:*"` flag on `stitch_video.py` enables cherry-picking scenes across different runs. Scene 2 from run001, rest from run002.
- **Quality Fallback**: `--fallback-quality` flag on `parallel_video_gen.py` auto-downgrades from quality→fast tier on generation failure.
- **Logo Preview**: `--preview` flag on `generate_logo_animation.py` opens the animation in the default media player after generation.
- **Auto-Simplify Prompts**: `--auto-simplify` flag on `parallel_video_gen.py` progressively simplifies prompts on failure (Level 1: remove Subtle/Ambient, Level 2: Camera+Subject only, Level 3: minimal generic prompt).

### Technical Details
- Added `format_i2v_command()` to utils.py - formats veo-cli command for I2V mode handling backend differences
- Added `simplify_prompt()` to utils.py - 4-level progressive prompt simplification
- Added `parse_mix_spec()` to utils.py - parses "run001:2 run002:*" format into {scene→run} mapping
- Added `add_hold_frame()` to generate_logo_animation.py - FFmpeg-based last-frame extraction and concatenation
- Added `get_mixed_scene_files()` to stitch_video.py - cherry-picks scene files across runs based on mix spec
- Updated `generate_scene_with_retry()` with fallback quality and auto-simplify retry logic

### CLI Arguments (generate_logo_animation.py additions)
| Argument | Default | Description |
|----------|---------|-------------|
| `--hold-end` | 0 | Freeze final frame for N seconds at end |
| `--preview` | false | Open animation in default player after generation |

### CLI Arguments (stitch_video.py additions)
| Argument | Default | Description |
|----------|---------|-------------|
| `--mix` | None | Cherry-pick scenes: "run001:2 run002:*" |

### CLI Arguments (parallel_video_gen.py additions)
| Argument | Default | Description |
|----------|---------|-------------|
| `--fallback-quality` | false | Auto-fallback from quality→fast on failure |
| `--auto-simplify` | false | Progressive prompt simplification on failure |

### Bug Fixes
- **Fixed I2V with useapi backend**: Previously the `-i` flag was used for both backends, but useapi requires `image:` prefix in prompt text. Now handled automatically.

---

## v2.37 (2026-02-15)

### New Features
- **Film Pipeline Orchestrator**: New `film_pipeline.py` provides a stateful orchestrator for full cinematic production: concept -> analysis -> screenplay -> characters -> breakdown -> images -> videos -> audio -> stitch -> complete. Supports `--concept` for top-down creation and `--reference-video` for COPY-to-Film reproduction. `--resume-from` enables recovery from any phase.
- **Screenplay Generator**: New `screenplay_generator.py` uses Gemini to generate screenplays with per-scene keyframes (2-5 keyframes at ~3s each), act structure, and visual direction.
- **Story Engine**: New `story_engine.py` with 3 bottom-up modes: `story` (generate narrative from concept), `transitions` (analyze frame directory for scene connections), `enhance` (improve existing f2v_scenes.json with story context).
- **Scene Breakdown**: New `scene_breakdown.py` generates backend-aware video generation prompts — Seedance gets time-segmented prompts with camera vocabulary, Veo gets flat SEALCAM prompts.
- **Character Designer**: New `character_designer.py` extracts characters from screenplay, generates Go Bananas portrait prompts with character references, and assigns ElevenLabs voices.
- **Film Dashboard Server**: New `film_dashboard_server.py` HTTP server on port 8766 with live pipeline state, screenplay display, character gallery, and scene timeline. 5 Vue dashboard components (FilmDashboard, PipelineProgress, ScreenplayPanel, CharacterGallery, SceneTimeline).
- **COPY-to-Film Mode**: `--reference-video` on `film_pipeline.py` runs SEALCAM+ analysis on a reference video, auto-generates a screenplay, and reproduces it on any backend.
- **Seedance Deep Integration**: Multimodal `@` references, one-take shot prompts, atmosphere banks, Chinese camera vocabulary mapping, smart polling (30s initial delay, 15s intervals), flex service tier (50% cost savings), media validation.

### Technical Details
- New script `film_pipeline.py` (~1,150 lines): `FilmPipeline` class with 10 phase methods, state persistence, and backend dispatch
- New script `screenplay_generator.py` (~986 lines): Gemini-powered screenplay generation with act structure, keyframes, and visual direction
- New script `story_engine.py` (~1,165 lines): 3 CLI subcommands (story, transitions, enhance) with narrative arc analysis
- New script `scene_breakdown.py` (~570 lines): backend-aware prompt generation with Seedance time-segment support
- New script `character_designer.py` (~835 lines): character extraction, Go Bananas portrait prompts, voice assignment
- New script `film_dashboard_server.py` (~535 lines): HTTP server with 5 API endpoints
- New Vue components: FilmDashboard, PipelineProgress, ScreenplayPanel, CharacterGallery, SceneTimeline
- New DB tables: `screenplays` and `filmCharacters` in both SQLite and Convex
- New exceptions: `ScreenplayError`, `CharacterDesignError`, `StoryEngineError`
- 805 new tests across 8 wave directories, 109 Vue component tests
- 4,065 total tests pass, 0 failures

### CLI Arguments (film_pipeline.py)
| Argument | Default | Description |
|----------|---------|-------------|
| `--concept` | None | Concept description for top-down creation |
| `--reference-video` | None | Reference video path for COPY-to-Film mode |
| `--project` | required | Project slug |
| `--duration` | 30 | Target duration in seconds |
| `--scenes` | 6 | Number of scenes to generate |
| `--backend` | `useapi` | Backend: direct, useapi, seedance |
| `--resume-from` | None | Resume from phase |
| `--dry-run` | false | Preview pipeline plan without executing |

---

## v2.36 (2026-02-15)

### New Features
- **Edit Prompt Templates**: 8 template types (color_change, object_swap, style_transfer, background_change, weather_change, time_of_day, add_element, remove_element) with `@video1` reference pattern for `edit_video.py`.
- **Extension Prompt Templates**: Forward/backward extension templates with time-segmented continuation prompts for `extend_video.py`.
- **Beat-Sync Prompt Builder**: 9 genre patterns (epic_orchestral, electronic_edm, hip_hop, cinematic_trailer, etc.) with BPM-aware time segments.
- **Seedance Task Status CLI**: New `seedance_task_status.py` for querying, watching, and cancelling Seedance tasks.
- **Seedance Prompt DB**: New `seedance_prompt_db.py` — SQLite-backed prompt library with search, expand, and beat-sync subcommands.
- **Quality Fallback**: If `seedance_2.0` model is unavailable, auto-retries with `seedance_2.0_fast`. Max 1 downgrade per scene.
- **Assembly Utils**: New `assembly_utils.py` shared library. `nex_assemble.py --backend seedance --lipsync-scenes "17,18"` skips TTS bake for native audio scenes.
- **Pre-batch Balance Check**: `check_balance()` queries `/api/v3/balance` before generation.
- **Upload MCP Fallback**: xskill MCP upload via SSE+JSON-RPC for CDN URLs on `cdn-video.51sux.com`.
- **Prompt DB Mode Awareness**: `f2v_loop=True` triggers subtle prompts instead of cinematic camera vocabulary.

### Technical Details
- New script `seedance_prompt_db.py`: SQLite prompt library with stats, search, cameras, expand, beat-sync subcommands
- New script `seedance_task_status.py`: query, watch, cancel subcommands for task management
- New script `assembly_utils.py`: shared assembly helpers for unified Seedance/Veo workflows
- Updated `seedance_prompt_builder.py` (+780 lines): edit/extension templates, beat-sync builder
- Updated `seedance_backend.py` (+208 lines): quality fallback, resolution warning, balance check
- Updated `utils_upload.py` (+246 lines): xskill MCP upload via SSE+JSON-RPC, expanded fallback chain
- 70 new tests, 1,510 total tests pass, 0 regressions

### Bug Fixes
- **Fixed amix duration=shortest causing 48-byte broken outputs**: Changed stitch_video.py mixed audio mode from `duration=shortest` to `duration=first`, removed redundant `-shortest` flag.

---

## v2.35 (2026-02-14)

### New Features
- **Seedance Cinematic Prompt Engine**: New `seedance_prompt_builder.py` auto-enhances prompts with cinematic camera vocabulary (36 movements), style tokens (10 genres), time-segmented storyboarding, and negative prompts. Activated via `--prompt-enhance` flag.
- **Seedance Batch Orchestrator**: New `seedance_batch.py` for large-scale generation with queue JSON, concurrent polling, checkpointing, and submit-only/poll-only overnight workflow.
- **Camera Reference Video**: `--camera-ref` on `parallel_video_gen.py` replicates camera movement from a reference video in Seedance T2V and I2V modes.
- **Upload Chain Improvements**: Expanded `_extract_video_url()` to handle 5 response shapes.

### Technical Details
- New script `seedance_prompt_builder.py` (~545 lines): prompt formatting, camera vocabulary, style tokens, time segments
- New script `seedance_batch.py` (~770 lines): batch queue management, concurrent polling, checkpoint resume
- 36 camera movement vocabulary terms, 10 genre-based style token sets
- 85 new tests (48 prompt builder + 37 batch), 1,647 total tests pass, 0 regressions

### CLI Arguments (parallel_video_gen.py additions)
| Argument | Default | Description |
|----------|---------|-------------|
| `--prompt-enhance` | false | Auto-enhance prompts with cinematic camera vocabulary |
| `--camera-ref` | None | Reference video for camera movement replication |

---

## v2.34 (2026-02-14)

### New Features
- **Upload Fallback Chain**: `utils_upload.py` expanded with multi-provider fallback: xskill.ai -> imgbb.com -> catbox.moe. Addresses catbox.moe URLs being inaccessible from Seedance's Chinese infrastructure.
- **Duration Validation**: After download, if actual video duration < 80% of requested, Seedance auto-retries once.
- **Nex Assembly Script**: New `nex_assemble.py` automates final assembly: loop videos to TTS duration -> bake narration -> normalize FPS -> concat with filter -> add background music.
- **Title/Credits Generator**: New `generate_title_credits.py` creates standalone title cards and scrolling credits.
- **Concat Filter Threshold**: For 8+ segments, uses FFmpeg concat FILTER instead of DEMUXER to prevent A/V timestamp drift.
- **amix Fix**: `dropout_transition=600` set across all stitchers to prevent early audio termination on silent sections.

### Technical Details
- Updated `utils_upload.py` with `upload_to_xskill()`, `upload_to_imgbb()` functions and fallback chain
- New `nex_assemble.py` (~450 lines): loop, bake, normalize, concat, add music
- New `generate_title_credits.py` (~330 lines): title card and scrolling credits
- New constant `CONCAT_FILTER_THRESHOLD = 8` in `config.py`
- 388 new tests across 8 modules

### CLI Arguments (nex_assemble.py)
| Argument | Default | Description |
|----------|---------|-------------|
| `--project` | required | Project directory path |
| `--num-slides` | required | Number of slides to assemble |
| `--intro-scenes` | None | Comma-separated intro scene numbers |
| `--outro-scenes` | None | Comma-separated outro scene numbers |
| `--music` | None | Background music file path |
| `--yes` | false | Skip confirmation prompts |

### Bug Fixes
- **Fixed amix audio termination**: `dropout_transition` values of 2-3 caused early audio cutoff on silent sections. Set to 600 across all stitchers.
- **Fixed concat timestamp drift**: Switched to concat filter for 8+ segment assemblies.
- **Fixed catbox.moe China accessibility**: Added imgbb.com and xskill.ai as upload fallbacks.

---

## v2.33 (2026-02-14)

### New Features
- **Seedance 2.0 Backend**: `--backend seedance` on `parallel_video_gen.py` adds a third video generation backend using ByteDance Seedance 2.0 REST API. Pure Python client with no veo-cli subprocess dependency.
- **Audio Lip-Sync Mode**: `--mode audio-lipsync` provides 1-step TTS-driven lip sync via Seedance (vs Veo's 3-step workflow).
- **Motion Transfer Mode**: `--mode motion-transfer` replicates motion from a reference video onto a character image.
- **Video Duration Control**: `--duration N` sets video duration in seconds (Seedance only: 4-15, default: 8).
- **Video Extension**: New `extend_video.py` extends existing videos by 4-15 seconds using Seedance continuation API.
- **Video Editing**: New `edit_video.py` modifies video content using Seedance plot editing.
- **Media Upload**: New `utils_upload.py` provides upload to catbox.moe with SHA-256 hash-based caching.

### Technical Details
- New script `seedance_backend.py` (~450 lines): create task, poll, download, error classification
- New script `utils_upload.py` (~180 lines): upload with hash-based deduplication cache
- New scripts: `extend_video.py`, `edit_video.py`
- New exceptions: `SeedanceError`, `UploadError`
- Module-level `_seedance_kwargs` dict pattern for backend-specific options
- 68 new tests (40 seedance_backend, 28 utils_upload), 1,501 total tests pass

### CLI Arguments (parallel_video_gen.py additions)
| Argument | Default | Description |
|----------|---------|-------------|
| `--backend seedance` | - | Use Seedance 2.0 backend |
| `--mode audio-lipsync` | - | Audio-driven lip sync via Seedance |
| `--mode motion-transfer` | - | Motion transfer from reference video |
| `--duration` | 8 | Video duration in seconds (4-15) |
| `--motion-ref` | None | Reference video for motion transfer |
| `--tts-dir-lipsync` | None | TTS directory for audio lip-sync |

### Backend Comparison
| Capability | direct/useapi | seedance |
|------------|---------------|----------|
| Text-to-Video | Yes | Yes |
| Frames-to-Video (I2V) | Yes | Yes |
| Audio Lip-Sync | No (3-step workaround) | Yes (1-step) |
| Motion Transfer | No | Yes |
| Video Extension | No | Yes (4-15s) |
| Video Editing | No | Yes |

---

## v2.32 (2026-02-08)

### New Features
- **Chained F2V Generation**: `--chained` on `parallel_video_gen.py` enables sequential frame-to-video generation where each scene starts from the last frame of the previous scene.
- **Chain Controls**: `--chain-from N` to resume, `--chain-retries N` and `--chain-retry-delay N` for resilience.
- **Last Frame Extraction**: `--last-frame` and `--video-dir` on `extract_frames.py` for chained workflows.
- **Journey Templates**: `--journey-template` applies pre-built camera motion templates (property_tour, building_ascent, nature_walk, product_reveal, architectural_walkthrough).
- **FPS Normalization**: `normalize_fps_if_needed()` auto-detects and re-encodes mismatched frame rates before concat.
- **Mixed Audio Source Stitching**: `--veo-audio-scenes "19,20"` keeps Veo's lip-synced audio for specified scenes while baking TTS onto remaining scenes.
- **Lip-Sync Mode**: `--lip-sync` and `--dialogue` embed dialogue in Veo prompts for lip-synced speech generation.
- **Skip Scenes**: `--skip-scenes "19,20"` on `generate_tts.py` excludes scenes from TTS generation.
- **Stale Video Hardening**: Pre-clear + post-validate timestamps in `generate_scene()`.
- **Style Transfer**: New `style_transfer.py` automates Go Bananas reference_images + reference_mode workflow.

### Technical Details
- New script `f2v_journey_templates.py` with 5 journey templates
- New script `style_transfer.py` for reference groups and MCP commands
- New functions: `extract_last_frame()`, `get_fps()`, `normalize_fps_if_needed()`, `preprocess_mixed_audio_scenes()`, `format_lipsync_prompt()`, `clear_stale_veo_outputs()`, `validate_video_output()`
- New metadata file `lip_sync_scenes.json` auto-generated by `--lip-sync`
- Stitch reliability: output size validation (>=1KB), audio stream fallback, dimension mismatch detection
- Test coverage: 1,239 tests pass, 0 failures

### CLI Arguments (parallel_video_gen.py additions)
| Argument | Default | Description |
|----------|---------|-------------|
| `--chained` | false | Sequential F2V from previous scene's last frame |
| `--chain-from` | 1 | Resume chained generation from scene N |
| `--chain-retries` | 2 | Retries per scene in chained mode |
| `--chain-retry-delay` | 10 | Delay in seconds between chain retries |
| `--journey-template` | None | Pre-built camera motion template |
| `--lip-sync` | false | Embed dialogue in Veo prompts |
| `--dialogue` | None | JSON scene-to-dialogue mapping |

### Bug Fixes
- **Fixed FPS mismatch breaking stitched video**: Mixed frame rates caused silent/dropped last segment. Auto-normalization re-encodes to target FPS.
- **Fixed stale video silent reuse**: Pre-clear + post-validate prevents stale files from being reused.

---

## v2.31 (2026-02-06)

### New Features
- **Multi-Voice TTS**: `--voice-map` on `generate_tts.py` enables per-speaker voice mapping with automatic ElevenLabs voice ID resolution.
- **Quality Shortcuts**: `--draft` (fast/1 var) and `--final` (quality/2 vars) on `parallel_video_gen.py`.
- **Image Run Decoupling**: `--image-run run001` uses images from a different run prefix.
- **Video Extension for TTS**: `--extend-video` freezes last frame to match TTS duration.
- **TTS Auto-Detection**: `_find_tts_file()` checks multiple filename patterns.
- **Music Mood Hint**: `--music-mood` on `stitch_video.py` prints generate_music.py command.
- **Pre-flight Validation**: `--preflight` validates dependencies before generation.
- **Stitch Dry-Run**: `--dry-run` on `stitch_video.py` previews without encoding.
- **Progress Bars**: Terminal progress with ETA for video generation and stitching.

### Technical Details
- **Codebase Refactoring**: Split `utils.py` (2,750 lines) into 12 focused modules with backward-compatible facade
- Structured logging: 10 scripts migrated from `print()` to `logger.*()` with `--verbose` flags
- Type hints added to `parallel_video_gen.py`, `stitch_video.py`, `generate_tts.py`
- `ruff.toml` linter config with E, W, F, I, B, C4, UP, SIM rules
- Test coverage: 1,160 tests (up from 543), 0 failures

### CLI Arguments (parallel_video_gen.py additions)
| Argument | Default | Description |
|----------|---------|-------------|
| `--draft` | false | Quality shortcut: fast quality, 1 variation |
| `--final` | false | Quality shortcut: quality mode, 2 variations |
| `--image-run` | None | Use images from different run prefix |
| `--preflight` | false | Pre-flight validation before generation |

---

## v2.30 (2026-02-05)

### New Features
- **Character Consistency for Storyboards**: Phase 2.5 creates Go Bananas character references before scene generation for consistent face/body across all scenes.
- **Character Definition Workflow**: `--create-characters` generates portrait prompts from structured character JSON.
- **Character ID Persistence**: `--save-character-ids` saves Go Bananas IDs to `characters.json`.
- **Consistent Scene Generation**: `--generate-scenes` uses stored `character_ids` for all scenes.
- **Style Locking**: `--style` locks art style across all generations (default: "Disney Pixar 3D animated").

### Technical Details
- New dataclass `CharacterDefinition` with name, age, gender, hair, outfit fields
- New file `characters.json` for character definitions and Go Bananas IDs
- Migrated to `google-genai` package (replaces `google-generativeai`)

### CLI Arguments (generate_storyboard.py additions)
| Argument | Default | Description |
|----------|---------|-------------|
| `--create-characters` | false | Generate character portrait prompts |
| `--save-character-ids` | None | Comma-separated Go Bananas character IDs to save |
| `--generate-scenes` | false | Generate scenes using stored character_ids |
| `--style` | "Disney Pixar 3D animated" | Art style for all generations |
| `--characters` | None | JSON array of character definitions |

### Workflow
Phase 1 (grid) -> Phase 2 (split) -> **Phase 2.5 (character refs)** -> Phase 3 (scenes) -> Phase 4+ (videos)

---

## v2.29 (2026-02-04)

### New Features
- **Storyboard Grid Workflow**: Generate all 9 panels in a single 3x3 grid image for character/environment consistency, then split into individual scene frames.
- **8 Narrative Templates**: dialogue_confrontation, chase_pursuit, discovery_reveal, journey_transformation, romance_connection, comedy_surprise, horror_suspense, product_story.
- **Two-Phase Workflow**: Phase 1 outputs Go Bananas MCP call for grid; Phase 2 splits grid into 9 panels and generates dialogue.
- **Grid Splitting**: `split_grid.py` handles image splitting with aspect ratio awareness.
- **Full TTS Integration**: Phase 2 outputs `editable_transcript.json` for existing narration pipeline.
- **Square Grid Enforcement**: Grid must be 1:1 aspect ratio. MIN_GRID_SIZE lowered to 800px.

### Technical Details
- New script `generate_storyboard.py` with interactive wizard
- New modules: `storyboard_templates.py` (8 templates), `storyboard_prompts.py` (prompt builder), `split_grid.py` (grid splitting)
- New reference `storyboard-templates.md`
- Output: `storyboard_metadata.json`, `motion_prompts.json`, `editable_transcript.json`

### CLI Arguments (generate_storyboard.py)
| Argument | Default | Description |
|----------|---------|-------------|
| `--project` | required | Project slug |
| `--character-ids` | None | Comma-separated Go Bananas character IDs |
| `--template` | None | Narrative template name |
| `--premise` | None | Story premise text |
| `--environment` | None | Setting/environment description |
| `--aspect-ratio` | `16:9` | Target aspect ratio for scene frames |
| `--grid-image` | None | Path to grid image for Phase 2 splitting |
| `--list-templates` | false | List available templates |
| `--yes` | false | Skip confirmation |

---

## v2.28 (2026-02-04)

### New Features
- **Phase 7: CTA Banner Generator**: New `generate_cta_banner.py` generates animated call-to-action banners using Remotion. Supports slide-fade, slide, fade, and static animations with light/dark/transparent themes.
- **Phase 5a: Voice Designer**: New `voice_designer.py` designs custom AI voices using ElevenLabs Voice Design API. 10 preset voice archetypes, interactive questionnaires, browser-based A/B preview, and save-to-library.
- **Branding Module**: Brand setup wizard, website brand extractor, brand library, and logo variants — integrated with stitch and CTA banner workflows.
- **Logo Animation Presets Expanded**: 20 new presets added (mycelium-network, claymation-morph, ferrofluid-magnetism, etc.). Total: 29.

### Technical Details
- New script `generate_cta_banner.py` with Remotion integration for banner rendering
- New Remotion project `remotion-banner/` with CTABanner React compositions
- New script `voice_designer.py` with voice design, preview, and save functions
- New module `voice_presets.py` with 10 preset voice archetypes
- New branding modules: `brand_config.py`, `brand_extractor.py`, `brand_library.py`, `brand_wizard.py`
- Updated `stitch_video.py` with `--cta-banner` and `--cta-banner-timing` flags
- 29 unit tests for voice designer

### CLI Arguments (generate_cta_banner.py)
| Argument | Default | Description |
|----------|---------|-------------|
| `--logo` | None | Logo image path |
| `--phone` | None | Phone number to display |
| `--cta` | None | CTA button text |
| `--qr-url` | None | URL for QR code |
| `--theme` | `dark` | Theme: light, dark, transparent |
| `--animation` | `slide-fade` | Animation style |
| `--output` | auto | Output path |

### CLI Arguments (voice_designer.py)
| Argument | Default | Description |
|----------|---------|-------------|
| `--design-voice` | false | Enable voice design mode |
| `--preset-voice` | None | Use a preset voice archetype |
| `--questionnaire` | None | Interactive: simple (4Q) or detailed (8Q) |
| `--save-voice` | false | Save designed voice to library |
| `--voice-name` | None | Name for saved voice |
| `--list-presets` | false | List available presets |
| `--dry-run` | false | Preview without generating |

### CLI Arguments (stitch_video.py additions)
| Argument | Default | Description |
|----------|---------|-------------|
| `--cta-banner` | None | CTA banner video to overlay |
| `--cta-banner-timing` | `last-5s` | When to show: entire, last-Ns, custom-N |

---

## v2.18 (2026-01-30)

### New Features
- **Phase 5b: ElevenLabs TTS Narration**: New `generate_tts.py` script generates narration audio from transcripts using ElevenLabs text-to-speech API.
- **Per-scene TTS generation**: Generates individual audio files per scene, then concatenates into a combined narration track.
- **Mandatory transcript review**: Whisper output contains errors (misheard words, garbled phrases, wrong proper nouns). The editable transcript MUST be proofread and corrected before TTS generation.
- **Transcript editing workflow**: Dry-run generates `editable_transcript.json` for review; re-run with `--edit` to apply corrected text.
- **Voice selection**: `--voice-name` for search by name, `--voice-id` for direct selection, `--list-voices` to browse available voices.
- **Model selection**: `--list-models` to browse, default is `eleven_flash_v2_5`.
- **Cost preview**: Dry-run shows character counts and estimated cost per scene.
- **Narration in stitch**: New `--narration` and `--narration-volume` flags on `stitch_video.py` for 3-way audio mixing.

### Technical Details
- New script `generate_tts.py` with functions: `list_voices()`, `list_models()`, `find_voice_by_name()`, `generate_speech()`, `load_transcript()`, `load_edited_transcript()`, `get_scene_texts()`, `build_editable_transcript()`, `get_audio_duration()`, `generate_silence()`, `concatenate_audio_files()`, `dry_run()`
- Transcript loading supports standalone files (from `transcribe_audio.py`) and SEALCAM+-embedded transcripts
- Audio concatenation uses FFmpeg concat demuxer with optional silence padding
- Stitch audio modes added: `narration_full_mix` (3-way), `narration_music` (2-way), `narration_only`
- 3-way FFmpeg filter: `[va][ma][na]amix=inputs=3:duration=shortest:dropout_transition=2[aout]`
- Output: `projects/{slug}/audio/tts/scene_N_tts.mp3`, `audio/narration.mp3`, `audio/narration_manifest.json`

### CLI Arguments (generate_tts.py)
| Argument | Default | Description |
|----------|---------|-------------|
| `--transcript` | required | Path to transcript JSON (from Phase 1.5T) |
| `--output-dir` | required | Directory for per-scene audio files |
| `--combined-output` | auto | Path for combined narration track |
| `--voice-id` | None | ElevenLabs voice ID |
| `--voice-name` | None | Search voice by name (e.g., "Rachel") |
| `--model-id` | `eleven_flash_v2_5` | ElevenLabs model |
| `--scenes` | all | Comma-separated scene numbers |
| `--edit` | None | Path to edited transcript JSON |
| `--stability` | 0.5 | Voice stability (0.0-1.0) |
| `--similarity-boost` | 0.75 | Voice similarity (0.0-1.0) |
| `--format` | `mp3_44100_128` | Audio output format |
| `--pad-to-duration` | false | Pad scene audio with silence |
| `--list-voices` | false | List voices and exit |
| `--list-models` | false | List models and exit |
| `--dry-run` | false | Preview without calling API |
| `--yes` / `-y` | false | Skip confirmation |

### CLI Arguments (stitch_video.py additions)
| Argument | Default | Description |
|----------|---------|-------------|
| `--narration` | None | Narration audio file path |
| `--narration-volume` | 0.9 | Narration volume (0.0-1.0) |

## v2.17 (2026-01-30)

### New Features
- **Phase 1.5T: Audio Transcription (Optional)**: New `transcribe_audio.py` script transcribes video audio using OpenAI Whisper CLI (local, free).
- **Standalone transcription**: Extract and transcribe audio with scene alignment to SEALCAM+ timestamps.
- **Inline transcription**: New `--transcribe` flag on `analyze_video.py` runs Whisper after analysis and embeds transcript in SEALCAM+ JSON.
- **Whisper model selection**: `--whisper-model` flag supports tiny/base/small/medium/large models.
- **Scene-aligned transcripts**: Maps Whisper segments to SEALCAM+ scenes using timestamp overlap detection.
- **Dry-run mode**: Check Whisper installation, audio stream, and speech detection before transcribing.
- **Graceful failure**: Transcription errors never block video analysis — wrapped in try/except.

### Technical Details
- New script `transcribe_audio.py` with functions: `check_whisper_installed()`, `extract_audio_track()`, `run_whisper()`, `align_transcript_to_scenes()`, `build_transcript_output()`, `dry_run()`
- Audio extraction: FFmpeg converts to 16kHz mono WAV (Whisper's optimal format)
- Scene alignment: Overlap test `seg_start < scene_end and seg_end > scene_start`
- Output: `projects/{slug}/analysis/transcript.json` (standalone) or embedded in `sealcam_analysis.json`
- Uses `audio_utils.has_audio_stream()` and `detect_speech()` for dry-run checks
- Uses `utils.parse_sealcam_timestamp()` for scene timestamp parsing

### CLI Arguments (transcribe_audio.py)
| Argument | Default | Description |
|----------|---------|-------------|
| `--video` | required | Path to video file |
| `--analysis` | optional | SEALCAM+ JSON (for scene alignment) |
| `--output` | auto | Output transcript JSON path |
| `--model` | `medium` | Whisper model: tiny/base/small/medium/large |
| `--language` | auto-detect | Force language code (en, hi, es, etc.) |
| `--dry-run` | false | Preview without running Whisper |

### CLI Arguments (analyze_video.py additions)
| Argument | Default | Description |
|----------|---------|-------------|
| `--transcribe` | false | Run Whisper after analysis |
| `--whisper-model` | `medium` | Whisper model size |

### Output JSON Structure
```json
{
  "transcript": {
    "full_text": "Complete transcription...",
    "language": "en",
    "duration": 30.5,
    "model": "medium",
    "segments": [{"start": 0.0, "end": 2.5, "text": "..."}]
  },
  "scene_transcripts": [
    {"scene_number": 1, "text": "...", "segments": [...], "has_speech": true}
  ],
  "_metadata": {"source_video": "path", "whisper_model": "medium", "generated_at": "..."}
}
```

## v2.16 (2026-01-30)

### New Features
- **Phase 1.5: Frame Extraction**: New `extract_frames.py` script extracts reference frames from analyzed videos at SEALCAM+ scene timestamps for style transfer or visual reference.
- **Batch extraction**: Extract one frame per scene from SEALCAM+ analysis JSON with configurable position (start/middle/end of each scene).
- **Single scene/timestamp**: Extract frame for a specific scene number or at an arbitrary timestamp.
- **Auto keyframe detection**: FFmpeg scene-change detection for videos without analysis (--keyframes mode).
- **Dry-run preview**: Preview what would be extracted without running FFmpeg (--dry-run).
- **Style transfer workflow**: Extract frame → upload to Go Bananas `edit_uploaded_image` → restyle with character while preserving pose/composition.
- **Visual reference workflow**: Extract frame → use as pose/composition inspiration for fresh `generate_image` calls.

### Technical Details
- Added `parse_sealcam_timestamp()` to utils.py — Parses SEALCAM+ timestamp ranges ("0:03-0:06") to seconds, supports start/middle/end position extraction
- Added `extract_frame_ffmpeg()` to utils.py — Single-frame extraction using FFmpeg fast-seek (`-ss` before `-i`) with `-frames:v 1`
- New script `extract_frames.py` with 4 modes: batch, single scene, timestamp, keyframes
- Transition scenes automatically skipped (uses `filter_content_scenes()`)
- Output: `projects/{slug}/reference/frames/scene_N_frame.{jpg|png}`

### CLI Arguments
| Argument | Description |
|----------|-------------|
| `--video` | Source video file (required) |
| `--analysis` | SEALCAM+ analysis JSON (for batch/scene mode) |
| `--scene N` | Extract single scene by number |
| `--timestamp "M:SS"` | Extract at arbitrary timestamp |
| `--keyframes` | Auto-detect scene changes |
| `--position` | `start` (default), `middle`, or `end` of each scene |
| `--format` | `jpg` (default) or `png` |
| `--threshold` | Keyframe sensitivity 0.0-1.0 (default: 0.4) |
| `--include-transitions` | Include transition scenes (skipped by default) |
| `--dry-run` | Preview without extracting |

### Behavior Summary
| Scenario | Result |
|----------|--------|
| Batch with analysis JSON | One frame per content scene extracted |
| Transition scenes | Skipped by default (use `--include-transitions` to include) |
| Single scene (--scene 3) | Extracts frame for scene 3 only |
| Arbitrary timestamp (--timestamp "0:15") | Extracts frame at 15 seconds |
| Auto keyframes (--keyframes) | FFmpeg detects scene changes, no analysis needed |
| Dry-run | Prints timestamps and scene info without extracting |

## v2.15 (2026-01-27)

### Bug Fixes
- **Fixed landscape image dimension mismatch**: Go Bananas "16:9" aspect ratio outputs ultrawide (1584×672, ratio 2.36) but Veo expects true 16:9 (1280×720, ratio 1.78). This caused content to be cropped during video generation.

### New Features
- **Auto-resize for landscape mode**: `parallel_video_gen.py` now auto-resizes images to 1280×720 before video generation (enabled by default for landscape mode)
- **`resize_to_landscape()` function**: New utility in utils.py for resizing images to standard 16:9 dimensions
- **`prefer_landscape` flag**: `find_frame_image()` now looks for `_landscape.jpg` suffix when in landscape mode
- **Parallel to portrait auto-crop**: Landscape auto-resize follows the same pattern as portrait auto-crop

### Technical Details
- Added constants: `LANDSCAPE_WIDTH=1280`, `LANDSCAPE_HEIGHT=720`, `LANDSCAPE_RATIO=16/9`
- Added `resize_to_landscape()` function using macOS `sips` with PIL fallback
- Added `_resize_landscape_with_pil()` helper for cross-platform support
- Added `prefer_landscape` parameter to `find_frame_image()` and `validate_image_aspect_ratios()`
- Original files preserved, resized files get `_landscape.jpg` suffix

### Go Bananas Aspect Ratio Reference
| Go Bananas Option | Output Size | Actual Ratio | After Resize |
|-------------------|-------------|--------------|--------------|
| `16:9` | 1584×672 | 2.36 (21:9 ultrawide) | 1280×720 |
| `landscape` | 1408×768 | 1.83 | 1280×720 |
| `3:2` | 1264×848 | 1.49 | 1280×720 |

### Behavior Summary
| Scenario | Before | After |
|----------|--------|-------|
| Go Bananas "16:9" (1584×672) | Cropped during video gen | Auto-resized to 1280×720 |
| Go Bananas "landscape" (1408×768) | Slight crop | Auto-resized to 1280×720 |
| Already 1280×720 | Works | Skip (no processing) |

## v2.14 (2026-01-27)

### Bug Fixes
- **Fixed image-run-id mismatch**: Images downloaded with `run001_` prefix were not found when video generation incremented to `run002`. Added automatic prefix sync.
- **Fixed manifest format handling**: Both `get_current_run_id()` and `increment_run()` now handle string format (`"run001"`) and integer format (`1`) in manifest.json.

### New Features
- **Automatic image run prefix sync**: `parallel_video_gen.py` auto-detects and renames images to match the expected run prefix before generation.
- **Transition scene detection**: SEALCAM+ analysis now identifies scene types (`content`, `transition`, `text_overlay`) and recommends which scenes to skip.
- **Content scene filtering**: New `is_transition_scene()` and `filter_content_scenes()` helpers in utils.py.
- **Subject count validation**: Image analyzer now checks for correct number of subjects. If prompt says "two women" but image has 3 people, it's flagged as FAIL.

### Technical Details
- Added `sync_image_run_prefix()` - Renames images to match expected run ID
- Added `detect_image_run_prefix()` - Detects run prefix used in images directory
- Added `is_transition_scene()` - Checks if a scene should be skipped
- Added `filter_content_scenes()` - Filters out transition scenes from analysis
- Added `_extract_expected_subject_count()` - Parses prompt for expected subject count
- Added `_check_subject_count()` - Pre-check comparing expected vs actual subjects
- Updated SEALCAM+ prompt with `scene_type` and `skip_recommended` fields
- Updated `video_analysis` with `content_scene_count` and `transition_scene_count`
- Updated `QUALITY_ANALYSIS_PROMPT` with strict subject count instructions

### Behavior Summary
| Scenario | Before | After |
|----------|--------|-------|
| Images: run001, Generation: run002 | **FAIL** (no images found) | Auto-sync to run002 |
| Manifest: "run001" (string) | **CRASH** (ValueError) | Works |
| Transition scene (blank bg) | Included in prompts | Marked `skip_recommended: true` |
| Prompt: "two women", Image: 3 people | Score 0.72 (marginal) | **FAIL** (0.65, wrong count) |

### Migration Notes
- Existing projects work without changes
- New analyses will include `scene_type` and `skip_recommended` fields
- Old analyses without these fields are handled gracefully

## v2.13 (2026-01-26)

### Bug Fixes
- **Fixed stale image tolerance too strict**: Images created 1 second before run start were incorrectly flagged as stale. Added 120-second grace period BEFORE run start for CREATE mode workflow where images are downloaded before video generation begins.
- **Image naming mismatch**: Added `download_scene_images()` helper to download images with correct naming (`scene_N_frame.jpg` instead of `scene_01.jpg`).

### New Features
- **`--yes` / `-y` flag**: Skip confirmation prompts in `parallel_video_gen.py` for scripting/automation.
- **`download_scene_images()` helper**: Download Go Bananas images with correct naming convention:
  - Handles run_id prefix (`run001_scene_1_frame.jpg`)
  - Handles variations (`scene_1_frame_v2.jpg`)
  - Auto-detects file extension from URL

### Technical Details
- Updated `validate_file_freshness()` with `grace_period_before` parameter (default: 120 seconds)
- This fixes CREATE mode where: 1) images downloaded, 2) run created in manifest, 3) stale check fails because images are older than run
- The grace period allows files created up to 2 minutes BEFORE the run timestamp

### Behavior Summary
| Scenario | Before | After |
|----------|--------|-------|
| Image created 1 second before run | **FAIL** | Works |
| Image created 2 minutes before run | **FAIL** | Works |
| Image created 3 minutes before run | **FAIL** | **FAIL** (truly stale) |
| Image from previous day/run | **FAIL** | **FAIL** |

## v2.12 (2026-01-26)

### Bug Fixes
- **Fixed stale IMAGE reuse across runs**: Images from previous runs (e.g., Shiva) could be silently reused in new runs (e.g., Krishna), causing wrong first-frames in I2V mode
- **Root cause**: `validate_image_freshness()` was imported but never called at generation time

### New Features
- **Image freshness validation at generation time**: `generate_scene()` now validates image timestamps before use
- **`--allow-stale` flag**: Override stale image check when intentionally reusing old images
- **Run prefix validation**: Checks that images have the current run prefix (e.g., `run001_scene_1_frame.jpg`)
- **Clear error messages**: STALE IMAGE errors show which image failed and how to fix it

### Technical Details
- Added `allow_stale: bool = False` parameter to `generate_scene()`, `generate_scene_with_retry()`, and `run_sequential_generation()`
- Added `--allow-stale` CLI flag to argparse
- Validation uses existing `validate_image_freshness()` and `get_run_start_timestamp()` from utils.py
- Added `project_path` to `find_frame_image_variation()` call for Tier 1 run-structure lookup
- Validation only runs in I2V mode when both `run_id` and `project_path` are available
- T2V mode (no images) and legacy projects (no runs/) are unaffected

### Behavior Summary
| Scenario | Before | After |
|----------|--------|-------|
| Fresh images, current run | Works | Works |
| Stale images from previous run | **Silent reuse** | **FAIL with error** |
| `--allow-stale` flag | N/A | Warn but proceed |
| Legacy project (no runs/) | Works | Works (skip validation) |
| T2V mode (no images) | Works | Works |

## v2.11 (2026-01-26)

### Bug Fixes
- **Fixed video mixing from veo-cli output directory**: Stale videos in `veo-cli/output-videos/` are now cleaned before generation, preventing content from previous runs being mixed into new outputs
- **Timestamp validation in copy_and_rename_outputs()**: Added `min_timestamp` parameter to reject files older than the current generation
- **Fixed useapi error messages**: Object errors are now properly stringified instead of showing `[object Object]`

### New Features
- **Pre-generation cleanup**: `clean_veo_output_directory()` removes stale scene files before veo-cli runs
- **Generation timestamp tracking**: Each scene records start time for output validation
- **Two-pronged stale file protection**: Pre-cleanup + post-validation ensures reliability

### Technical Details
- Added `clean_veo_output_directory(veo_path, scene_nums)` to `parallel_video_gen.py`
- Added `min_timestamp` parameter to `copy_and_rename_outputs()` function
- Added `generation_start_time` tracking in `generate_scene()` with 60s clock tolerance
- Fixed error handling in `veo-cli/src/backends/useapi/client.ts` `uploadImage()` method
- Root cause: Old files with matching patterns were picked up when new generation failed

### Related Issues
- Scenes 3, 6, 7 in Krishna video showed Shiva content (from previous run)
- Scene 6 failed with unhelpful "Image upload failed: [object Object]" error

## v2.10 (2026-01-25)

### Bug Fixes
- **Fixed auto-crop not finding run-prefixed images**: Auto-crop now correctly finds images with run prefix (e.g., `run001_scene_1_frame.jpg`)
- **Root cause**: `find_frame_image()` call in auto-crop section was missing `run_id` parameter

### New Features
- **Post-crop dimension validation**: After auto-crop, validates all images are at expected 504×896 dimensions
- **Dimension warnings in strict validation**: `validate_images_strict()` now accepts `expected_ratio` parameter
- **Enhanced print_strict_validation()**: Shows dimension warnings for portrait mode images

### Technical Details
- Added `run_id` lookup before auto-crop loop using `get_current_run_id(project_path)`
- Added dimension validation loop after auto-crop with clear warning messages
- Added `expected_ratio` parameter to `validate_images_strict()` function
- Added `dimension_warnings` list to validation result
- Updated `print_strict_validation()` to display dimension warnings

## v2.9 (2026-01-25)

### Bug Fixes
- **Fixed image stale data bug**: Images without run prefix could be reused across runs (stale data)
- **Run prefix validation for images**: Images are now expected to have run prefix (`run001_scene_1_frame.jpg`) to match videos

### New Features
- **Image freshness validation**: `validate_image_freshness()` and `validate_images_freshness()` functions (parallel to v2.8 video validation)
- **Run prefix checking**: `validate_images_strict()` now reports images missing run prefix
- **Stale image warnings**: `print_stale_images_warning()` displays clear warning when images predate current run
- **Enhanced pre-flight output**: Shows NO RUN PREFIX and STALE flags for problematic images

### Technical Details
- Added `validate_file_freshness()` as generic base function for both images and videos
- Updated `validate_images_strict()` with `project_path` and `check_freshness` parameters
- Enhanced `print_strict_validation()` to show warnings for stale/unprefixed images
- Updated `parallel_video_gen.py` to import new validation functions and pass project_path
- Images are expected to match video naming: `run001_scene_1_frame.jpg` (not just `scene_1_frame.jpg`)

### Breaking Changes
- None (backwards compatible - missing run prefix generates warning, not error)

## v2.8 (2026-01-25)

### Bug Fixes
- **Fixed video mixing bug**: Videos from previous runs no longer get mixed into fresh runs
- **Always clean for fresh runs**: Removed condition that skipped cleaning when `use_run_dirs=True`
- **Added timestamp validation**: Videos are now verified to be newer than run start time

### New Features
- **Freshness check in stitch**: Warns when videos predate the current run
- **`validate_video_freshness()`**: New utility function for timestamp validation
- **`get_run_start_timestamp()`**: New function to get run creation time from manifest
- **`validate_videos_freshness()`**: Batch validation of multiple video files

### Technical Details
- Root cause: `use_run_dirs=True` skipped ALL cleaning (`parallel_video_gen.py:858`)
- Added `min_timestamp` parameter to `verify_scene_outputs()` for freshness validation
- Stitch script now auto-infers project_path from videos_dir for validation
- Manifest timestamps now used for validation (previously stored but unused)

## v2.7 (2026-01-24)

- **Character Prompt Simplification**: When using `character_id`, prompts should describe action/pose only - NOT appearance
- **New Reference**: `character-prompts.md` with good vs bad examples and pattern detection guide
- **Prompt Validation**: `generate_images.py` warns about verbose prompts that may override character references
- **Auto-Simplify**: `simplify_prompt_for_character()` in `gobananas_prompts.py` strips appearance descriptions
- **Root Cause Fix**: Over-described prompts (names, expressions, ages) cause Go Bananas to ignore `character_id`

## v2.6 (2026-01-24)

- **Mandatory Image Review Checkpoint**: STOP after image generation - user MUST review and approve before video generation
- **Presenter Mode for Stitching**: `--presenter` flag sets optimal audio mix for voice-over videos (music=25%, voice=85%)
- **Audio Presets**: Default mode (ambient) vs presenter mode for different video types
- **Cost Protection**: Prevents wasting video generation credits on unapproved images

## v2.5 (2026-01-23)

- **Project Organization**: Date-prefixed project folders (`YYYY-MM-DD_NNN_slug`) for easy sorting
- **Run Versioning**: Each generation creates a versioned run (run001, run002...) to prevent artifact mix-ups
- **Safe Defaults**: Default behavior is fresh run + clean old files (safest workflow)
- **New Scripts**: `create_project.py` and `migrate_project.py` for project management
- **Run Flags**: `--fresh` (default) and `--continue` for `parallel_video_gen.py`
- **Stitch Run Selection**: `--run runNNN` flag for `stitch_video.py` (auto-picks latest if not specified)
- **Manifest Tracking**: `manifest.json` in each project tracks run history and metadata
- **Legacy Support**: Existing projects continue to work; `migrate_project.py --dry-run` for safe migration

## v2.4 (2026-01-22)

- **Phase 3b: Image Quality Review**: Auto-regeneration for low-quality images
- **Image QA Agent**: Pre-validates images with quality scores and recommendations
- **Auto-Regenerate**: Failed images (score < 0.65) auto-regenerate up to 3 times
- **Go Bananas Pro Model**: Always use `gemini-pro-image` for better quality

## v2.3 (2026-01-22)

- **Agent-Assisted Review Mode**: AI agents handle image/video review
- **Review Orchestrator**: Coordinates entire agent-assisted workflow
- **Video Comparison Agent**: Ranks primary vs alt video variants

## v2.2 (2026-01-17)

- **Interactive Review Mode**: Web-based review dashboard with checkpoints
- **Aspect Ratio Auto-Fix**: Center-crops mismatched images to target ratio
- **Review Server**: HTTP server for dashboard approvals
- **Checkpoint State**: `review_state.json` tracks pipeline progress

## v2.1 (2026-01-17)

- **Dual Modes**: COPY (replicate reference videos) + CREATE (original content from scratch)
- **Interactive Wizard**: Step-by-step scene builder for CREATE mode (`create_wizard.py`)
- **Scene Templates**: Pre-built templates for Product Ads, Fashion, Brand Stories, Social Reels
- **Asset Collection**: Structured workflow for characters and products with Go Bananas integration
- **Enhanced Go Bananas docs**: Complete upload workflow with quick reference table
- **Example Config**: Added `example-config.json` for `create_wizard.py --config` option

## v2.0 (2026-01-16)

- **SEALCAM+ Framework**: Enhanced analysis with micromotion, keyframes, and structured motion data
- **4 Prompt Types**: Optimized prompts for T2V, I2V, F2V, R2V generation modes
- **Motion-Only I2V**: Don't re-describe images - focus on movement instructions
- **Start Frame Analysis**: Analyze generated frames before creating motion prompts
- **SQLite Database**: Track projects, scenes, videos, and learn from successes/failures
- **Motion Templates**: Library of reusable motion patterns for consistent results
- **Auto-retry Logic**: `parallel_video_gen.py` retries failed scenes 2x with 30s delay
- **Flexible Pattern Matching**: Finds videos with non-standard tags
- **Output Verification**: Validates both primary and alt videos exist (>100KB)
- **Recovery Commands**: Prints exact veo-cli commands to retry failed scenes
- **Aspect Ratio Detection**: Auto-detects portrait/landscape from source images

## v1.0 (Initial)

- Basic SEALCAM framework for video analysis
- Single video generation mode
- Manual scene-by-scene workflow
