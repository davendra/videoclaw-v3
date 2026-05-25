#!/usr/bin/env python3
"""
PRESENTATION Mode Orchestrator

Coordinates the full pipeline for restyling slide-based presentation videos:
  Phase 0: PDF Pre-Processing (optional) — edit slides via nano-pdf and Go Bananas
  Phase 1: Detect slides (extract_frames.py --detect-slides) OR extract PDF pages
  Phase 2: Extract audio (ffmpeg) — skipped for PDF input
  Phase 3: Restyle slides (Go Bananas MCP — handled by Claude, not this script)
  Phase 4: Generate animations (generate_animation_prompts.py + parallel_video_gen.py)
  Phase 5: Prepare audio (original extraction, custom file, TTS, or AI narration)
  Phase 6: Stitch with timing sync (stitch_video.py --sync-timestamps)

Usage:
    # Full pipeline from video (interactive — pauses for user input)
    python presentation_mode.py \
      --video "path/to/presentation.mp4" \
      --project "{slug}"

    # PDF input with equal duration
    python presentation_mode.py \
      --pdf "slides.pdf" --project "{slug}" \
      --total-duration 120 --animation dynamic --yes

    # PDF input with AI narration (auto-determines timing)
    python presentation_mode.py \
      --pdf "slides.pdf" --project "{slug}" \
      --narration-driven --voice-name "Rachel" \
      --animation cinematic

    # PDF input with slide editing (Phase 0)
    python presentation_mode.py \
      --pdf "slides.pdf" --project "{slug}" \
      --edit-slides

    # Non-interactive with all options
    python presentation_mode.py \
      --video "path/to/presentation.mp4" \
      --project "{slug}" \
      --animation dynamic \
      --audio original \
      --threshold 0.3 \
      --yes

    # Resume from specific phase
    python presentation_mode.py \
      --project "{slug}" \
      --resume-from 4 \
      --animation dynamic

    # Regenerate specific scenes
    python presentation_mode.py \
      --project "{slug}" \
      --regenerate-scenes "3,7,12" \
      --animation dynamic

    # Status check
    python presentation_mode.py \
      --project "{slug}" \
      --status
"""

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys

from logging_config import setup_logging

# Module-level logger — verbose can be enabled via setup_logging(__name__, verbose=True)
logger = setup_logging(__name__)

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))


def get_project_dir(project_slug: str) -> str:
    """Resolve project directory from slug."""
    projects_base = os.path.join(os.path.dirname(SCRIPTS_DIR), "..", "..", "projects")
    projects_base = os.path.abspath(projects_base)

    # Direct path
    direct = os.path.join(projects_base, project_slug)
    if os.path.isdir(direct):
        return direct

    # Search for date-prefixed match
    if os.path.isdir(projects_base):
        for entry in sorted(os.listdir(projects_base), reverse=True):
            if entry.endswith(f"_{project_slug}"):
                return os.path.join(projects_base, entry)

    # Create if doesn't exist
    os.makedirs(direct, exist_ok=True)
    return direct


def load_slides_json(project_dir: str) -> dict | None:
    """Load slides.json from project analysis directory."""
    path = os.path.join(project_dir, "analysis", "slides.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def save_slides_json(project_dir: str, data: dict):
    """Save slides.json to project analysis directory."""
    path = os.path.join(project_dir, "analysis", "slides.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def print_status(project_dir: str):
    """Print current pipeline status for a project."""
    slides_data = load_slides_json(project_dir)

    logger.info("=" * 60)
    logger.info("PRESENTATION Mode Status")
    logger.info("=" * 60)
    logger.info("Project: %s", os.path.basename(project_dir))

    # Phase completion detection
    completed = detect_completed_phases(project_dir)
    phase_names = {
        1: "Detect/Extract Slides",
        2: "Extract Audio",
        3: "Restyle Images",
        4: "Generate Videos",
        5: "Prepare Audio/TTS",
        6: "Stitch Final Output",
    }
    logger.info("")
    logger.info("Phase Completion:")
    for phase in range(1, 7):
        mark = "[x]" if completed[phase] else "[ ]"
        logger.info("  %s Phase %d: %s", mark, phase, phase_names[phase])

    # Determine next action
    next_phase = None
    for phase in range(1, 7):
        if not completed[phase]:
            next_phase = phase
            break
    if next_phase:
        logger.info("Next: Phase %d (%s)", next_phase, phase_names[next_phase])
    else:
        logger.info("All phases complete!")
    logger.info("")

    if not slides_data:
        logger.info("Status: No slides.json found - Phase 1 not started")
        return

    slides = slides_data.get("slides", [])
    settings = slides_data.get("settings", {})

    logger.info("Total slides: %d", slides_data.get('total_slides', len(slides)))
    logger.info("Source: %s", slides_data.get('source_video', 'unknown'))
    logger.info("Duration: %.1fs", slides_data.get('source_duration', 0))
    logger.info("Animation: %s", settings.get('animation_style', 'not set'))
    logger.info("Audio: %s", settings.get('audio_source', 'not set'))

    # Per-slide status
    status_counts = {}
    for slide in slides:
        s = slide.get("status", "unknown")
        status_counts[s] = status_counts.get(s, 0) + 1

    logger.info("Slide status:")
    for status, count in sorted(status_counts.items()):
        logger.info("  %s: %d", status, count)

    # Check for generated files
    images_dir = os.path.join(project_dir, "images")
    videos_dir = os.path.join(project_dir, "videos")
    audio_dir = os.path.join(project_dir, "audio")
    final_dir = os.path.join(project_dir, "final")

    if os.path.isdir(images_dir):
        images = [f for f in os.listdir(images_dir) if f.endswith((".jpg", ".png"))]
        logger.info("Images: %d files", len(images))
    if os.path.isdir(videos_dir):
        videos = [f for f in os.listdir(videos_dir) if f.endswith(".mp4")]
        logger.info("Videos: %d files", len(videos))
    if os.path.isdir(audio_dir):
        audios = [f for f in os.listdir(audio_dir) if f.endswith((".mp3", ".wav"))]
        logger.info("Audio: %d files", len(audios))
    if os.path.isdir(final_dir):
        finals = [f for f in os.listdir(final_dir) if f.endswith(".mp4")]
        logger.info("Final: %d files", len(finals))

    logger.info("=" * 60)


def phase0_preprocess(
    pdf_path: str,
    project_dir: str,
    dpi: int = 100,
) -> list[str]:
    """Phase 0: Quick-extract all PDF pages as low-res preview images.

    Returns list of preview image paths.
    """
    logger.info("=" * 60)
    logger.info("Phase 0: PDF Pre-Processing")
    logger.info("=" * 60)

    slides_dir = os.path.join(project_dir, "slides")
    os.makedirs(slides_dir, exist_ok=True)

    # Import extract function from extract_pdf_slides
    sys.path.insert(0, SCRIPTS_DIR)
    from extract_pdf_slides import convert_pdf_to_images, get_pdf_page_count

    page_count = get_pdf_page_count(pdf_path)
    logger.info("PDF: %s (%d pages)", os.path.basename(pdf_path), page_count)
    logger.info("Extracting low-res previews at %d DPI...", dpi)

    preview_paths = convert_pdf_to_images(pdf_path, slides_dir, dpi=dpi)

    logger.info("Slides:")
    for i, path in enumerate(preview_paths, start=1):
        logger.info("  [%d] %s", i, os.path.basename(path))

    logger.info("Preview images saved to: %s", slides_dir)
    logger.info("=" * 60)
    return preview_paths


def phase0_apply_text_edits(
    pdf_path: str,
    edits: list[dict],
    output_path: str,
) -> str:
    """Apply text edits to PDF using nano-pdf.

    Args:
        pdf_path: Path to the source PDF.
        edits: List of dicts with 'page' (1-based int) and 'instruction' (str).
        output_path: Where to save the edited PDF.

    Returns the path to the edited PDF.
    """
    logger.info("Applying %d text edit(s) via nano-pdf...", len(edits))

    # Build nano-pdf edit args: page1 "instruction1" page2 "instruction2" ...
    edit_args = []
    for edit in edits:
        edit_args.append(str(edit["page"]))
        edit_args.append(edit["instruction"])

    cmd = ["nano-pdf", "edit", pdf_path] + edit_args + ["--output", output_path]

    logger.info("Running: nano-pdf edit %s ...", os.path.basename(pdf_path))
    for edit in edits:
        logger.info("  Page %s: %s", edit['page'], edit['instruction'])

    # nano-pdf expects GEMINI_API_KEY; map from GOOGLE_API_KEY if needed
    env = os.environ.copy()
    if "GEMINI_API_KEY" not in env and "GOOGLE_API_KEY" in env:
        env["GEMINI_API_KEY"] = env["GOOGLE_API_KEY"]

    result = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        logger.error("nano-pdf error: %s", result.stderr.strip())
        sys.exit(1)

    if result.stdout.strip():
        logger.info("%s", result.stdout.strip())

    logger.info("Edited PDF saved to: %s", output_path)
    return output_path


def phase0_reextract_pages(
    pdf_path: str,
    pages: list[int],
    slides_dir: str,
    project_dir: str,
    dpi: int = 200,
) -> list[str]:
    """Re-extract only the edited pages at full quality.

    Also updates the corresponding scene_N_frame.jpg in images/.

    Args:
        pdf_path: Path to the edited PDF.
        pages: List of 1-based page numbers that were edited.
        slides_dir: Directory containing slide images.
        project_dir: Project root directory.
        dpi: Render DPI for full-quality extraction.

    Returns list of re-extracted image paths.
    """
    sys.path.insert(0, SCRIPTS_DIR)
    from extract_pdf_slides import extract_single_page

    logger.info("Re-extracting %d edited page(s) at %d DPI...", len(pages), dpi)

    reextracted = []
    images_dir = os.path.join(project_dir, "images")
    os.makedirs(images_dir, exist_ok=True)

    for page_num in pages:
        # Re-extract the slide image
        slide_path = extract_single_page(pdf_path, page_num, slides_dir, dpi=dpi)
        reextracted.append(slide_path)

        # Also update the downstream scene frame image
        scene_dst = os.path.join(images_dir, f"scene_{page_num}_frame.jpg")
        shutil.copy2(slide_path, scene_dst)
        logger.info("Updated %s", os.path.basename(scene_dst))

    logger.info("Re-extracted %d page(s)", len(reextracted))
    return reextracted


def phase1_detect_slides(
    video_path: str,
    project_dir: str,
    threshold: float = 0.3,
    dry_run: bool = False,
) -> dict:
    """Phase 1: Detect slides in the presentation video."""
    logger.info("=" * 60)
    logger.info("Phase 1: Detect Slides")
    logger.info("=" * 60)

    slides_dir = os.path.join(project_dir, "slides")
    analysis_dir = os.path.join(project_dir, "analysis")
    slides_json = os.path.join(analysis_dir, "slides.json")

    os.makedirs(slides_dir, exist_ok=True)
    os.makedirs(analysis_dir, exist_ok=True)

    cmd = [
        sys.executable,
        os.path.join(SCRIPTS_DIR, "extract_frames.py"),
        "--video", video_path,
        "--detect-slides",
        "--threshold", str(threshold),
        "--output-dir", slides_dir,
        "--output-json", slides_json,
    ]

    if dry_run:
        cmd.append("--dry-run")
        logger.info("[DRY RUN] Would run: %s", ' '.join(cmd))
        return {}

    logger.info("Video: %s", video_path)
    logger.info("Threshold: %s", threshold)
    logger.info("Output: %s", slides_json)

    result = subprocess.run(cmd, capture_output=False, text=True)
    if result.returncode != 0:
        logger.error("Slide detection failed (exit code %d)", result.returncode)
        sys.exit(1)

    slides_data = load_slides_json(project_dir)
    if not slides_data:
        logger.error("slides.json not created")
        sys.exit(1)

    num_slides = len(slides_data.get("slides", []))
    logger.info("Detected %d slides", num_slides)
    return slides_data


def phase1_extract_pdf(
    pdf_path: str,
    project_dir: str,
    total_duration: float | None = None,
    dpi: int = 200,
    dry_run: bool = False,
) -> dict:
    """Phase 1 (PDF): Extract slides from PDF file."""
    logger.info("=" * 60)
    logger.info("Phase 1: Extract PDF Slides")
    logger.info("=" * 60)

    slides_dir = os.path.join(project_dir, "slides")
    analysis_dir = os.path.join(project_dir, "analysis")
    slides_json = os.path.join(analysis_dir, "slides.json")

    os.makedirs(slides_dir, exist_ok=True)
    os.makedirs(analysis_dir, exist_ok=True)

    cmd = [
        sys.executable,
        os.path.join(SCRIPTS_DIR, "extract_pdf_slides.py"),
        "--pdf", pdf_path,
        "--output-dir", slides_dir,
        "--output-json", slides_json,
        "--dpi", str(dpi),
    ]

    if total_duration:
        cmd.extend(["--total-duration", str(total_duration)])

    if dry_run:
        cmd.append("--dry-run")
        logger.info("[DRY RUN] Would run: %s", ' '.join(cmd))
        return {}

    logger.info("PDF: %s", pdf_path)
    logger.info("DPI: %d", dpi)
    logger.info("Output: %s", slides_json)

    result = subprocess.run(cmd, capture_output=False, text=True)
    if result.returncode != 0:
        logger.error("PDF extraction failed (exit code %d)", result.returncode)
        sys.exit(1)

    slides_data = load_slides_json(project_dir)
    if not slides_data:
        logger.error("slides.json not created")
        sys.exit(1)

    num_slides = len(slides_data.get("slides", []))
    logger.info("Extracted %d slides from PDF", num_slides)
    return slides_data


def phase5_narration_driven(
    project_dir: str,
    voice_name: str = "Rachel",
    style: str = "professional",
    dry_run: bool = False,
    yes: bool = False,
) -> str | None:
    """Phase 5 (narration-driven): Generate narration script, TTS, and update durations."""
    logger.info("=" * 60)
    logger.info("Phase 5: AI Narration (narration-driven)")
    logger.info("=" * 60)

    slides_json = os.path.join(project_dir, "analysis", "slides.json")
    slides_dir = os.path.join(project_dir, "slides")
    tts_dir = os.path.join(project_dir, "audio", "tts")
    transcript_path = os.path.join(tts_dir, "editable_transcript.json")

    os.makedirs(tts_dir, exist_ok=True)

    # Step 5a: Generate narration script via Gemini Vision
    logger.info("Step 5a: Generate narration script (%s style)", style)
    narration_cmd = [
        sys.executable,
        os.path.join(SCRIPTS_DIR, "generate_narration_script.py"),
        "--slides-json", slides_json,
        "--slides-dir", slides_dir,
        "--output", transcript_path,
        "--style", style,
    ]

    if dry_run:
        narration_cmd.append("--dry-run")

    result = subprocess.run(narration_cmd, capture_output=False, text=True)
    if result.returncode != 0:
        logger.error("Narration script generation failed")
        sys.exit(1)

    if dry_run:
        return None

    # Step 5b: Generate TTS audio from transcript
    logger.info("Step 5b: Generate TTS audio (voice: %s)", voice_name)

    # generate_tts.py needs a transcript file — use the editable transcript directly
    tts_cmd = [
        sys.executable,
        os.path.join(SCRIPTS_DIR, "generate_tts.py"),
        "--transcript", transcript_path,
        "--output-dir", tts_dir,
        "--edit", transcript_path,
        "--voice-name", voice_name,
    ]

    if yes:
        tts_cmd.append("--yes")

    result = subprocess.run(tts_cmd, capture_output=False, text=True)
    if result.returncode != 0:
        logger.error("TTS generation failed")
        sys.exit(1)

    # Step 5c: Update slides.json durations from TTS durations
    logger.info("Step 5c: Update slide durations from TTS")

    tts_manifest = os.path.join(tts_dir, "narration_manifest.json")
    if os.path.exists(tts_manifest):
        with open(tts_manifest) as f:
            manifest = json.load(f)

        slides_data = load_slides_json(project_dir)
        if slides_data:
            buffer = 1.5  # seconds of buffer after speech ends

            current_time = 0.0
            for slide in slides_data.get("slides", []):
                scene_key = str(slide["slide"])
                # Find TTS duration for this scene
                scene_tts = None
                for entry in manifest.get("scenes", []):
                    if str(entry.get("scene")) == scene_key:
                        scene_tts = entry
                        break

                if scene_tts and scene_tts.get("duration", 0) > 0:
                    new_duration = scene_tts["duration"] + buffer
                    slide["duration"] = round(new_duration, 2)
                    slide["tts_duration"] = round(scene_tts["duration"], 2)

                # Recompute timestamps sequentially
                slide["timestamp_seconds"] = round(current_time, 2)
                secs = current_time
                mins = int(secs // 60)
                secs = secs % 60
                slide["timestamp"] = f"{mins:02d}:{secs:05.2f}"
                current_time += slide["duration"]

            slides_data["source_duration"] = round(current_time, 2)
            save_slides_json(project_dir, slides_data)
            logger.info("Updated %d slide durations", len(slides_data['slides']))
            logger.info("New total duration: %.1fs", current_time)

    # Step 5d: Re-sync TTS to updated slide durations
    # After Step 5c updated durations, re-generate narration with silence padding
    # so each scene's TTS matches its slide duration
    logger.info("Step 5d: Sync TTS to slide durations")

    sync_cmd = [
        sys.executable,
        os.path.join(SCRIPTS_DIR, "generate_tts.py"),
        "--edit", transcript_path,
        "--output-dir", tts_dir,
        "--sync-to-slides", slides_json,
        "--voice-name", voice_name,
    ]

    if yes:
        sync_cmd.append("--yes")

    result = subprocess.run(sync_cmd, capture_output=False, text=True)
    if result.returncode != 0:
        logger.warning("TTS sync failed, falling back to unsynced narration")
        # Fall through to return unsynced narration
    else:
        # Return synced narration if available
        synced_file = os.path.join(tts_dir, "narration_synced.mp3")
        if os.path.exists(synced_file):
            logger.info("Using synced narration: %s", synced_file)
            return synced_file

    # Return path to combined narration (fallback)
    narration_file = os.path.join(tts_dir, "narration.mp3")
    if os.path.exists(narration_file):
        return narration_file

    return None


def phase2_extract_audio(
    video_path: str,
    project_dir: str,
    dry_run: bool = False,
) -> str:
    """Phase 2: Extract audio from the presentation video."""
    logger.info("=" * 60)
    logger.info("Phase 2: Extract Audio")
    logger.info("=" * 60)

    audio_dir = os.path.join(project_dir, "audio")
    os.makedirs(audio_dir, exist_ok=True)
    output_path = os.path.join(audio_dir, "original.mp3")

    if os.path.exists(output_path):
        logger.info("Audio already extracted: %s", output_path)
        return output_path

    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vn",
        "-acodec", "libmp3lame",
        "-ab", "192k",
        output_path,
    ]

    if dry_run:
        logger.info("[DRY RUN] Would run: %s", ' '.join(cmd))
        return output_path

    logger.info("Extracting audio to: %s", output_path)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        logger.error("Audio extraction failed: %s", result.stderr[:200])
        sys.exit(1)

    size_mb = os.path.getsize(output_path) / 1024 / 1024
    logger.info("Extracted: %s (%.1f MB)", output_path, size_mb)
    return output_path


def phase4_generate_animations(
    project_dir: str,
    animation_style: str,
    scenes: str | None = None,
    quality: str = "fast",
    dry_run: bool = False,
    yes: bool = False,
) -> None:
    """Phase 4: Generate animation prompts and videos."""
    logger.info("=" * 60)
    logger.info("Phase 4: Generate Animations (%s)", animation_style)
    logger.info("=" * 60)

    slides_json = os.path.join(project_dir, "analysis", "slides.json")
    images_dir = os.path.join(project_dir, "images")
    videos_dir = os.path.join(project_dir, "videos")

    os.makedirs(videos_dir, exist_ok=True)

    slides_data = load_slides_json(project_dir)
    if not slides_data:
        logger.error("slides.json not found. Run Phase 1 first.")
        sys.exit(1)

    # Step 4a: Generate animation prompts via Gemini Vision
    if animation_style in ("dynamic", "both"):
        prompts_style = "dynamic"
    elif animation_style == "subtle":
        prompts_style = "subtle"
    else:
        prompts_style = "cinematic"
    prompts_output = os.path.join(project_dir, "analysis", "animation_prompts.json")

    logger.info("Step 4a: Generate animation prompts (%s style)", prompts_style)
    prompt_cmd = [
        sys.executable,
        os.path.join(SCRIPTS_DIR, "generate_animation_prompts.py"),
        "--slides-json", slides_json,
        "--images-dir", images_dir,
        "--output", prompts_output,
        "--style", prompts_style,
    ]

    if scenes:
        prompt_cmd.extend(["--scenes", scenes])
    if dry_run:
        prompt_cmd.append("--dry-run")

    result = subprocess.run(prompt_cmd, capture_output=False, text=True)
    if result.returncode != 0:
        logger.error("Prompt generation failed")
        sys.exit(1)

    if dry_run:
        return

    # Load generated prompts
    if os.path.exists(prompts_output):
        with open(prompts_output) as f:
            prompts = json.load(f)
    else:
        logger.error("animation_prompts.json not created")
        sys.exit(1)

    # Step 4b: Generate videos
    logger.info("Step 4b: Generate videos")

    # Build scenes dict for parallel_video_gen
    scenes_dict = {}
    target_slides = slides_data.get("slides", [])
    if scenes:
        scene_nums = [int(s.strip()) for s in scenes.split(",")]
        target_slides = [s for s in target_slides if s["slide"] in scene_nums]

    for slide in target_slides:
        slide_num = str(slide["slide"])
        prompt = prompts.get(slide_num) or slide.get("animation_prompt")
        if prompt:
            scenes_dict[slide_num] = prompt
        else:
            logger.warning("No prompt for slide %s, skipping", slide_num)

    if not scenes_dict:
        logger.error("No animation prompts available for video generation")
        sys.exit(1)

    slug = os.path.basename(project_dir)

    video_cmd = [
        sys.executable,
        os.path.join(SCRIPTS_DIR, "parallel_video_gen.py"),
        "--product", slug,
        "--mode", "frames-to-video",
        "--images-dir", images_dir,
        "--scenes", json.dumps(scenes_dict),
        "--ratio", "landscape",
        "--quality", quality,
        "--variations", "1",
        "--allow-stale",
    ]

    if animation_style in ("dynamic", "subtle", "both"):
        video_cmd.append("--f2v-loop")

    if yes:
        video_cmd.append("--yes")

    logger.info("Generating %d scenes...", len(scenes_dict))
    result = subprocess.run(video_cmd, capture_output=False, text=True)
    if result.returncode != 0:
        logger.error("Video generation failed")
        sys.exit(1)

    # Update slides.json with generated video info
    slides_data = load_slides_json(project_dir)
    if slides_data:
        for slide in slides_data.get("slides", []):
            slide_num = str(slide["slide"])
            if slide_num in scenes_dict:
                slide["status"] = "generated"
        slides_data.setdefault("settings", {})["animation_style"] = animation_style
        save_slides_json(project_dir, slides_data)


DEFAULT_PRESENTER_INTRO = "Welcome to this presentation. Let me walk you through the key points."
DEFAULT_PRESENTER_OUTRO = "Thank you for watching. I hope you found this presentation insightful."

# Default scene numbers for presenter clips — high numbers to avoid collisions
# with slide scenes (typically 1-20). Users can override via --scene-numbers.
DEFAULT_PRESENTER_INTRO_SCENE = 901
DEFAULT_PRESENTER_OUTRO_SCENE = 902


def phase_presenter_character(
    project_dir: str,
    character_id: int,
    intro_dialogue: str | None = None,
    outro_dialogue: str | None = None,
    voice_id: str | None = None,
    scene_numbers: tuple[int, int] | None = None,
    quality: str = "fast",
    dry_run: bool = False,
    yes: bool = False,
) -> tuple[str | None, str | None]:
    """Generate presenter intro/outro videos using a Go Bananas character.

    This phase:
    1. Outputs Go Bananas MCP command to generate a landscape presenter image
    2. Generates lip-sync intro/outro videos via parallel_video_gen.py
    3. Optionally voice-changes the clips (if voice_id provided)
    4. Returns paths to intro/outro videos for use in phase6_stitch

    Args:
        project_dir: Path to the project directory.
        character_id: Go Bananas character_id for the presenter.
        intro_dialogue: Spoken text for the intro clip.
        outro_dialogue: Spoken text for the outro clip.
        voice_id: ElevenLabs voice_id for voice-change (optional).
        scene_numbers: Tuple of (intro_scene_num, outro_scene_num). Uses
            high defaults (901, 902) to avoid collisions with slide scenes.
        quality: Video generation quality ('fast' or 'quality').
        dry_run: If True, output plan without executing.
        yes: Skip confirmation prompts.

    Returns:
        Tuple of (intro_video_path, outro_video_path). Either may be None
        if that clip was not requested or generation was skipped.
    """
    logger.info("=" * 60)
    logger.info("Phase 5.5: Presenter Character")
    logger.info("=" * 60)

    intro_text = intro_dialogue or DEFAULT_PRESENTER_INTRO
    outro_text = outro_dialogue or DEFAULT_PRESENTER_OUTRO
    slug = os.path.basename(project_dir)

    intro_scene = (scene_numbers[0] if scene_numbers else DEFAULT_PRESENTER_INTRO_SCENE)
    outro_scene = (scene_numbers[1] if scene_numbers else DEFAULT_PRESENTER_OUTRO_SCENE)

    # Create presenter directory
    presenter_dir = os.path.join(project_dir, "presenter")
    os.makedirs(presenter_dir, exist_ok=True)

    # Save presenter config metadata
    config = {
        "character_id": character_id,
        "intro_dialogue": intro_text,
        "outro_dialogue": outro_text,
        "voice_id": voice_id,
        "quality": quality,
        "intro_scene": intro_scene,
        "outro_scene": outro_scene,
    }
    config_path = os.path.join(presenter_dir, "presenter_config.json")
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    logger.info("Saved presenter config: %s", config_path)

    # --- Step 1: Output Go Bananas MCP command for presenter image ---
    logger.info("")
    logger.info("-" * 60)
    logger.info("Step 1: Generate presenter image")
    logger.info("-" * 60)

    images_dir = os.path.join(project_dir, "images")
    os.makedirs(images_dir, exist_ok=True)

    # Use numeric scene naming that parallel_video_gen.py expects
    presenter_image = os.path.join(images_dir, f"scene_{intro_scene}_frame.jpg")
    presenter_image_landscape = os.path.join(images_dir, f"scene_{intro_scene}_frame_landscape.jpg")

    if os.path.exists(presenter_image) or os.path.exists(presenter_image_landscape):
        logger.info("Presenter image already exists, skipping generation.")
        logger.info("  %s", presenter_image if os.path.exists(presenter_image) else presenter_image_landscape)
    else:
        print("\n" + "=" * 70)
        print("  GO BANANAS MCP CALL — Presenter Image")
        print("=" * 70)
        print("\nGenerate a LANDSCAPE presenter image for intro/outro clips:\n")
        print(f"""mcp__go-bananas__generate_image(
    prompt=\"\"\"WIDE HORIZONTAL shot. A professional presenter stands facing the camera,
confident posture, warm and welcoming expression, studio or office background,
soft professional lighting, shallow depth of field, ready to speak.\"\"\",
    character_id={character_id},
    aspect_ratio="16:9",
    model_id="gemini-pro-image"
)""")
        print("\n" + "-" * 70)
        print(f"After downloading, save the image as:")
        print(f"  {presenter_image}")
        print(f"  (auto-resize will create {os.path.basename(presenter_image_landscape)})")
        print("-" * 70)

        # Also save the image for outro (same image, different scene name)
        outro_image = os.path.join(images_dir, f"scene_{outro_scene}_frame.jpg")
        print(f"\nThen copy/symlink for the outro scene:")
        print(f"  cp {presenter_image} {outro_image}")
        print("-" * 70 + "\n")

        if dry_run:
            logger.info("[DRY RUN] Would wait for presenter image generation")
            return None, None

        if not yes:
            logger.info("")
            logger.info("Generate the presenter image above, then re-run with --presenter-character")
            logger.info("Or provide the image manually and continue.")
            return None, None

    # Ensure outro image exists (copy from intro if needed)
    outro_image = os.path.join(images_dir, f"scene_{outro_scene}_frame.jpg")
    if not os.path.exists(outro_image):
        src = presenter_image if os.path.exists(presenter_image) else presenter_image_landscape
        if os.path.exists(src):
            import shutil as _shutil
            _shutil.copy2(src, outro_image)
            logger.info("Copied presenter image for outro: %s", outro_image)

    # --- Step 2: Generate lip-sync intro/outro videos ---
    logger.info("")
    logger.info("-" * 60)
    logger.info("Step 2: Generate lip-sync videos")
    logger.info("-" * 60)
    logger.info("  Intro (scene %d): %s", intro_scene, intro_text[:60] + "..." if len(intro_text) > 60 else intro_text)
    logger.info("  Outro (scene %d): %s", outro_scene, outro_text[:60] + "..." if len(outro_text) > 60 else outro_text)

    # Build scenes and dialogue using numeric scene IDs
    intro_key = str(intro_scene)
    outro_key = str(outro_scene)

    scenes_dict = {
        intro_key: "Professional presenter speaks directly to camera, warm lighting, confident posture, studio background",
        outro_key: "Professional presenter speaks directly to camera, warm smile, wrapping up, studio background",
    }
    dialogue_dict = {
        intro_key: intro_text,
        outro_key: outro_text,
    }

    video_cmd = [
        sys.executable,
        os.path.join(SCRIPTS_DIR, "parallel_video_gen.py"),
        "--product", slug,
        "--mode", "frames-to-video",
        "--images-dir", images_dir,
        "--scenes", json.dumps(scenes_dict),
        "--lip-sync",
        "--dialogue", json.dumps(dialogue_dict),
        "--ratio", "landscape",
        "--quality", quality,
        "--variations", "1",
        "--allow-stale",
    ]

    if yes:
        video_cmd.append("--yes")

    if dry_run:
        logger.info("[DRY RUN] Would run: %s", " ".join(video_cmd))
    else:
        logger.info("Generating lip-sync videos...")
        result = subprocess.run(video_cmd, capture_output=False, text=True)
        if result.returncode != 0:
            logger.error("Presenter video generation failed")
            logger.error("You can retry by running presentation_mode.py again with --presenter-character")
            return None, None

    # --- Step 3: Voice-change (optional) ---
    videos_dir = os.path.join(project_dir, "videos")
    intro_video = _find_presenter_video(videos_dir, intro_scene)
    outro_video = _find_presenter_video(videos_dir, outro_scene)

    if voice_id and not dry_run:
        logger.info("")
        logger.info("-" * 60)
        logger.info("Step 3: Voice-change presenter clips")
        logger.info("-" * 60)
        logger.info("  Voice ID: %s", voice_id)

        vc_cmd = [
            sys.executable,
            os.path.join(SCRIPTS_DIR, "generate_tts.py"),
            "--voice-change",
            "--videos-dir", videos_dir,
            "--scenes", f"{intro_scene},{outro_scene}",
            "--voice-id", voice_id,
            "--seed", "42",
            "--remove-bg-noise",
        ]
        if yes:
            vc_cmd.append("--yes")

        result = subprocess.run(vc_cmd, capture_output=False, text=True)
        if result.returncode != 0:
            logger.warning("Voice-change failed, using original lip-sync audio")
        else:
            # Voice-changed files may have different naming
            intro_vc = _find_presenter_video(videos_dir, intro_scene, voice_changed=True)
            outro_vc = _find_presenter_video(videos_dir, outro_scene, voice_changed=True)
            if intro_vc:
                intro_video = intro_vc
            if outro_vc:
                outro_video = outro_vc
    elif voice_id and dry_run:
        logger.info("[DRY RUN] Would voice-change with voice_id=%s", voice_id)

    # Save paths to config
    config["intro_video"] = intro_video
    config["outro_video"] = outro_video
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)

    logger.info("")
    logger.info("Presenter videos:")
    logger.info("  Intro: %s", intro_video or "(not found)")
    logger.info("  Outro: %s", outro_video or "(not found)")
    logger.info("=" * 60)

    return intro_video, outro_video


def _find_presenter_video(
    videos_dir: str, scene_id: int, voice_changed: bool = False,
) -> str | None:
    """Find a presenter video file by numeric scene ID.

    Searches for common naming patterns in the videos directory.

    Args:
        videos_dir: Directory containing generated videos.
        scene_id: Numeric scene identifier (e.g. 901, 902).
        voice_changed: If True, look for voice-changed variants first.

    Returns:
        Path to the video file, or None if not found.
    """
    if not os.path.isdir(videos_dir):
        return None

    # Patterns to search, in priority order
    patterns = []
    if voice_changed:
        patterns.extend([
            f"*scene_{scene_id}_voice_changed.mp4",
            f"*scene_{scene_id}_vc.mp4",
        ])
    patterns.extend([
        f"*scene_{scene_id}_var*.mp4",
        f"*scene_{scene_id}.mp4",
    ])

    for pattern in patterns:
        matches = glob.glob(os.path.join(videos_dir, pattern))
        if matches:
            # Return the most recent match
            return max(matches, key=os.path.getmtime)

    return None


def phase6_stitch(
    project_dir: str,
    animation_style: str,
    audio_path: str | None = None,
    narration_path: str | None = None,
    transition: str | None = None,
    transition_duration: float = 0.5,
    logo_intro: str | None = None,
    logo_outro: str | None = None,
    dry_run: bool = False,
) -> str | None:
    """Phase 6: Stitch videos with timing sync."""
    logger.info("=" * 60)
    logger.info("Phase 6: Stitch (%s)", animation_style)
    logger.info("=" * 60)

    slides_json = os.path.join(project_dir, "analysis", "slides.json")
    videos_dir = os.path.join(project_dir, "videos")
    final_dir = os.path.join(project_dir, "final")
    os.makedirs(final_dir, exist_ok=True)

    slug = os.path.basename(project_dir)
    output_name = f"{slug}_{animation_style}.mp4"
    output_path = os.path.join(final_dir, output_name)

    # Determine sync mode
    if animation_style == "cinematic":
        sync_flag = "--freeze-first"
    elif animation_style in ("dynamic", "subtle"):
        sync_flag = "--loop-fill"
    else:
        # "both" — generate two outputs
        logger.info("Generating dual export...")
        _cinematic_output = phase6_stitch(
            project_dir, "cinematic", audio_path, narration_path,
            transition, transition_duration, logo_intro, logo_outro, dry_run,
        )
        dynamic_output = phase6_stitch(
            project_dir, "dynamic", audio_path, narration_path,
            transition, transition_duration, logo_intro, logo_outro, dry_run,
        )
        return dynamic_output  # Return the last one

    cmd = [
        sys.executable,
        os.path.join(SCRIPTS_DIR, "stitch_video.py"),
        "--videos-dir", videos_dir,
        "--output", output_path,
        "--sync-timestamps", slides_json,
        sync_flag,
        "--variations", "1",
    ]

    # Audio: use narration as primary if available
    if narration_path and os.path.exists(narration_path):
        cmd.extend(["--narration", narration_path, "--narration-volume", "0.9"])

    # Background music
    if audio_path and os.path.exists(audio_path):
        cmd.extend(["--audio", audio_path, "--narrated"])

    # No audio preservation (narration is the primary audio source)
    if narration_path:
        cmd.append("--no-preserve-audio")

    # Transitions
    if transition:
        cmd.extend(["--transition", transition, "--transition-duration", str(transition_duration)])

    # Presenter intro/outro
    if logo_intro and os.path.exists(logo_intro):
        cmd.extend(["--logo-intro", logo_intro])
        logger.info("Presenter intro: %s", logo_intro)
    if logo_outro and os.path.exists(logo_outro):
        cmd.extend(["--logo-outro", logo_outro])
        logger.info("Presenter outro: %s", logo_outro)

    if dry_run:
        logger.info("[DRY RUN] Would run: %s", ' '.join(cmd))
        return output_path

    logger.info("Output: %s", output_path)
    logger.info("Sync mode: %s", sync_flag)
    result = subprocess.run(cmd, capture_output=False, text=True)
    if result.returncode != 0:
        logger.error("Stitch failed")
        sys.exit(1)

    if os.path.exists(output_path):
        size_mb = os.path.getsize(output_path) / 1024 / 1024
        logger.info("Output: %s (%.1f MB)", output_path, size_mb)

    return output_path


def detect_completed_phases(project_dir: str) -> dict:
    """
    Detect which pipeline phases have completed based on output files.

    Returns:
        Dict with phase numbers as keys and completion status as values.
    """
    results = {}

    # Phase 1: slides.json exists
    slides_json = os.path.join(project_dir, "analysis", "slides.json")
    results[1] = os.path.exists(slides_json)

    # Phase 2: audio extracted (or PDF input = auto-complete)
    audio_path = os.path.join(project_dir, "audio", "original.mp3")
    results[2] = os.path.exists(audio_path)

    # Phase 3: restyled images exist in images/
    images_dir = os.path.join(project_dir, "images")
    if os.path.isdir(images_dir):
        image_files = [f for f in os.listdir(images_dir) if f.endswith(('.jpg', '.png', '.webp'))]
        results[3] = len(image_files) > 0
    else:
        results[3] = False

    # Phase 4: videos exist
    videos_dir = os.path.join(project_dir, "videos")
    if os.path.isdir(videos_dir):
        video_files = [f for f in os.listdir(videos_dir) if f.endswith(('.mp4', '.mov', '.webm'))]
        results[4] = len(video_files) > 0
    else:
        results[4] = False

    # Phase 5: narration or audio ready
    tts_dir = os.path.join(project_dir, "audio", "tts")
    narration = os.path.join(tts_dir, "narration.mp3") if os.path.isdir(tts_dir) else ""
    narration_synced = os.path.join(tts_dir, "narration_synced.mp3") if os.path.isdir(tts_dir) else ""
    results[5] = os.path.exists(narration) or os.path.exists(narration_synced)

    # Phase 6: final output exists
    final_dir = os.path.join(project_dir, "final")
    if os.path.isdir(final_dir):
        final_files = [f for f in os.listdir(final_dir) if f.endswith('.mp4')]
        results[6] = len(final_files) > 0
    else:
        results[6] = False

    return results


def main():
    parser = argparse.ArgumentParser(
        description="PRESENTATION Mode: Restyle slide-based presentation videos"
    )
    # Input source (video or PDF)
    parser.add_argument("--video", help="Path or URL to the presentation video")
    parser.add_argument("--pdf", help="Path to PDF slide deck (alternative to --video)")
    parser.add_argument("--project", required=True, help="Project slug")

    # Animation
    parser.add_argument("--animation", choices=["cinematic", "dynamic", "subtle", "both"],
                        default="subtle",
                        help="Animation style (default: subtle for presentations)")

    # Audio
    parser.add_argument("--audio", choices=["original", "custom", "tts"],
                        default="original",
                        help="Audio source (default: original)")
    parser.add_argument("--audio-file", help="Custom audio file path (when --audio custom)")

    # PDF-specific options
    parser.add_argument("--total-duration", type=float,
                        help="Total video duration for PDF slides (divided equally)")
    parser.add_argument("--narration-driven", action="store_true",
                        help="AI generates narration script; TTS duration sets slide timing")
    parser.add_argument("--voice-name", default="Rachel",
                        help="TTS voice for narration-driven mode (default: Rachel)")
    parser.add_argument("--narration-style",
                        choices=["professional", "casual", "educational", "pitch"],
                        default="professional",
                        help="Narration style for narration-driven mode")
    parser.add_argument("--dpi", type=int, default=200,
                        help="PDF render DPI (default: 200)")

    # Video-specific options
    parser.add_argument("--threshold", type=float, default=0.3,
                        help="Scene detection threshold (default: 0.3)")

    # Generation options
    parser.add_argument("--quality", choices=["fast", "quality"], default="fast",
                        help="Video generation quality (default: fast)")
    parser.add_argument("--transition", default=None,
                        help="Transition between slides (e.g., dissolve)")
    parser.add_argument("--transition-duration", type=float, default=0.5,
                        help="Transition duration in seconds")

    # Phase 0: PDF editing
    parser.add_argument("--edit-slides", action="store_true",
                        help="Enable interactive slide editing before pipeline (Phase 0)")
    parser.add_argument("--no-edit-slides", action="store_true",
                        help="Skip slide editing prompt (for automation)")

    # Presenter character options
    parser.add_argument("--presenter-character", type=int, default=None,
                        help="Go Bananas character_id for presenter intro/outro")
    parser.add_argument("--presenter-intro", type=str, default=None,
                        help="Dialogue for presenter intro (e.g., 'Welcome to our presentation!')")
    parser.add_argument("--presenter-outro", type=str, default=None,
                        help="Dialogue for presenter outro (e.g., 'Thanks for watching!')")
    parser.add_argument("--presenter-voice-id", type=str, default=None,
                        help="ElevenLabs voice_id for presenter (for voice-change on lip-sync clips)")
    parser.add_argument("--scene-numbers", type=str, default=None,
                        help="Comma-separated scene numbers for presenter clips (e.g., '17,18' = intro is 17, outro is 18). "
                             "Defaults to 901,902 to avoid collisions with slide scenes.")

    # Pipeline control
    parser.add_argument("--resume-from", type=int, choices=[1, 2, 3, 4, 5, 6],
                        help="Resume from specific phase")
    parser.add_argument("--regenerate-scenes", help="Comma-separated scene numbers to regenerate")
    parser.add_argument("--auto-resume", action="store_true",
                        help="Auto-detect completed phases and resume from next incomplete one")
    parser.add_argument("--status", action="store_true", help="Show pipeline status")
    parser.add_argument("--dry-run", action="store_true", help="Preview without executing")
    parser.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompts")
    parser.add_argument("--skip-restyle", action="store_true",
                        help="Skip Phase 3 (Go Bananas restyle) — use original slide images as animation frames. "
                             "Enables one-command PDF-to-video pipeline.")
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable verbose/debug logging")

    args = parser.parse_args()

    # Re-initialize logger with verbose flag if requested
    if args.verbose:
        global logger
        logger = setup_logging(__name__, verbose=True)

    project_dir = get_project_dir(args.project)
    logger.info("Project directory: %s", project_dir)

    # Status mode
    if args.status:
        print_status(project_dir)
        return

    # Regenerate mode
    if args.regenerate_scenes:
        logger.info("Regenerating scenes: %s", args.regenerate_scenes)
        phase4_generate_animations(
            project_dir,
            args.animation,
            scenes=args.regenerate_scenes,
            quality=args.quality,
            dry_run=args.dry_run,
            yes=args.yes,
        )
        # Re-stitch after regeneration
        slides_data = load_slides_json(project_dir)
        audio_path = None
        narration_path = None
        if slides_data:
            settings = slides_data.get("settings", {})
            audio_path = settings.get("audio_path")
        phase6_stitch(
            project_dir,
            args.animation,
            audio_path=audio_path,
            narration_path=narration_path,
            transition=args.transition,
            transition_duration=args.transition_duration,
            dry_run=args.dry_run,
        )
        return

    # Validate input flags
    is_pdf_input = bool(args.pdf)
    if args.pdf and args.video:
        logger.error("--pdf and --video are mutually exclusive")
        sys.exit(1)

    # Phase 0: PDF Editing (optional)
    pdf_path = os.path.abspath(args.pdf) if args.pdf else None
    if is_pdf_input and not args.no_edit_slides and not args.resume_from:
        # Copy original PDF to project reference dir
        ref_dir = os.path.join(project_dir, "reference")
        os.makedirs(ref_dir, exist_ok=True)
        original_pdf = os.path.join(ref_dir, os.path.basename(pdf_path))
        if not os.path.exists(original_pdf) or os.path.abspath(original_pdf) != os.path.abspath(pdf_path):
            shutil.copy2(pdf_path, original_pdf)
            logger.info("Saved original PDF to: %s", original_pdf)

        # Quick-extract previews
        preview_paths = phase0_preprocess(pdf_path, project_dir, dpi=100)

        if args.edit_slides:
            # Interactive editing mode — print instructions for Claude
            logger.info("=== SLIDE EDITING MODE ===")
            logger.info("%d slides ready for editing.", len(preview_paths))
            logger.info("Preview images in: %s", os.path.join(project_dir, 'slides'))
            logger.info("Edit types available:")
            logger.info("  - Text edits: nano-pdf edit \"%s\" <page> \"<instruction>\" --output \"%s\"", pdf_path, os.path.join(ref_dir, 'edited_slides.pdf'))
            logger.info("  - Image edits: Use Go Bananas MCP (generate_image / edit_image)")
            logger.info("After editing, re-extract changed pages with:")
            logger.info("  phase0_reextract_pages(edited_pdf, [page_nums], slides_dir, project_dir)")
            logger.info("Phase 0 paused. Use --resume-from 1 to continue after edits.")
            logger.info("Or run the full pipeline with --no-edit-slides to skip editing.")
            return
        elif not args.yes:
            logger.info("To edit slides before proceeding, re-run with --edit-slides")
            logger.info("To skip this message, use --yes or --no-edit-slides")

    # Update pdf_path if edited version exists
    if is_pdf_input:
        edited_pdf = os.path.join(project_dir, "reference", "edited_slides.pdf")
        if os.path.exists(edited_pdf):
            pdf_path = edited_pdf
            logger.info("Using edited PDF: %s", pdf_path)

    # Auto-resume: detect completed phases
    if args.auto_resume and not args.resume_from:
        completed = detect_completed_phases(project_dir)
        # Find first incomplete phase
        start_phase_auto = 7  # Default: all complete
        for phase in range(1, 7):
            if not completed[phase]:
                start_phase_auto = phase
                break

        if start_phase_auto > 1:
            completed_list = [str(p) for p in range(1, start_phase_auto)]
            logger.info("Auto-resume: Phases %s complete, starting from Phase %d",
                        ", ".join(completed_list), start_phase_auto)
            args.resume_from = start_phase_auto

        if start_phase_auto >= 7:
            logger.info("All phases complete! Final output exists in final/")
            logger.info("Use --resume-from 6 to re-stitch, or delete final/ to re-run.")
            return

    # Full pipeline
    start_phase = args.resume_from or 1

    if start_phase <= 1:
        if is_pdf_input:
            # PDF input: extract pages as images
            slides_data = phase1_extract_pdf(
                pdf_path, project_dir,
                total_duration=args.total_duration,
                dpi=args.dpi,
                dry_run=args.dry_run,
            )
        elif args.video:
            # Video input: detect slides via scene detection
            slides_data = phase1_detect_slides(
                args.video, project_dir,
                threshold=args.threshold,
                dry_run=args.dry_run,
            )
        else:
            logger.error("--video or --pdf is required for Phase 1")
            sys.exit(1)
    else:
        slides_data = load_slides_json(project_dir)
        if not slides_data:
            logger.error("No slides.json found. Run Phase 1 first (remove --resume-from).")
            sys.exit(1)

    # Check if this is a PDF-based project (from slides.json or flag)
    if slides_data:
        is_pdf_input = is_pdf_input or slides_data.get("source_type") == "pdf"

    if start_phase <= 2:
        if is_pdf_input:
            # PDF input: skip audio extraction (no audio in PDF)
            logger.info("=" * 60)
            logger.info("Phase 2: Extract Audio - SKIPPED (PDF input)")
            logger.info("=" * 60)
            audio_path = None
        else:
            video_path = args.video or slides_data.get("source_video")
            if not video_path:
                logger.error("No video path available for audio extraction")
                sys.exit(1)
            audio_path = phase2_extract_audio(video_path, project_dir, dry_run=args.dry_run)
    else:
        audio_path = os.path.join(project_dir, "audio", "original.mp3")
        if not os.path.exists(audio_path):
            audio_path = None

    # Phase 3: Restyle slides (handled by Claude via Go Bananas MCP)
    if start_phase <= 3:
        images_dir = os.path.join(project_dir, "images")

        if args.skip_restyle:
            logger.info("=" * 60)
            logger.info("Phase 3: Restyle Slides - SKIPPED (--skip-restyle)")
            logger.info("=" * 60)
            # Copy extracted slide images to images dir as animation frames
            slides_dir = os.path.join(project_dir, "slides")
            os.makedirs(images_dir, exist_ok=True)
            if os.path.isdir(slides_dir) and slides_data:
                copied = 0
                for slide in slides_data.get("slides", []):
                    slide_num = slide["slide"]
                    # Find the extracted slide image — try multiple naming patterns
                    image_name = slide.get("image") or slide.get("image_path")
                    if image_name:
                        src = os.path.join(slides_dir, image_name) if not os.path.isabs(str(image_name)) else str(image_name)
                    else:
                        src = os.path.join(slides_dir, f"slide_{slide_num}.jpg")
                    if not os.path.exists(src):
                        # Try zero-padded format (extract_pdf_slides uses slide_{N:03d}.jpg)
                        src = os.path.join(slides_dir, f"slide_{slide_num:03d}.jpg")
                    if not os.path.exists(src):
                        src = os.path.join(slides_dir, f"slide_{slide_num}.png")
                    if not os.path.exists(src):
                        src = os.path.join(slides_dir, f"slide_{slide_num:03d}.png")
                    if os.path.exists(src):
                        ext = os.path.splitext(src)[1]
                        dst = os.path.join(images_dir, f"scene_{slide_num}_frame{ext}")
                        if not os.path.exists(dst):
                            shutil.copy2(src, dst)
                            copied += 1
                        else:
                            copied += 1  # Already exists
                    else:
                        logger.warning("  Slide %d: image not found (tried slide_%d.jpg, slide_%03d.jpg)", slide_num, slide_num, slide_num)
                logger.info("Using %d/%d original slide images as animation frames", copied, len(slides_data.get("slides", [])))
            else:
                logger.warning("No slides directory found at %s", slides_dir)
        else:
            logger.info("=" * 60)
            logger.info("Phase 3: Restyle Slides")
            logger.info("=" * 60)
            logger.info("This phase is handled interactively via Go Bananas MCP.")
            logger.info("Images should be saved to: %s", images_dir)
            logger.info("Expected naming: scene_N_frame.jpg (or scene_N_frame_landscape.jpg)")

            if os.path.isdir(images_dir):
                images = [f for f in os.listdir(images_dir) if f.endswith((".jpg", ".png"))]
                if images:
                    logger.info("Found %d existing images", len(images))
                else:
                    logger.info("No images found yet. Generate via Go Bananas MCP,")
                    logger.info("then resume with: --resume-from 4")
                    if not args.dry_run:
                        return
            else:
                logger.info("Images directory not found: %s", images_dir)
                logger.info("Generate images first, then resume with: --resume-from 4")
                if not args.dry_run:
                    return

    if start_phase <= 4:
        phase4_generate_animations(
            project_dir,
            args.animation,
            quality=args.quality,
            dry_run=args.dry_run,
            yes=args.yes,
        )

    # Phase 5: Prepare audio
    narration_path = None
    if start_phase <= 5:
        if args.narration_driven:
            # AI narration: generate script + TTS + update durations
            narration_path = phase5_narration_driven(
                project_dir,
                voice_name=args.voice_name,
                style=args.narration_style,
                dry_run=args.dry_run,
                yes=args.yes,
            )
            # Reload slides_data after duration updates
            if not args.dry_run:
                slides_data = load_slides_json(project_dir)
        else:
            logger.info("=" * 60)
            logger.info("Phase 5: Prepare Audio (%s)", args.audio)
            logger.info("=" * 60)

            if args.audio == "original":
                narration_path = audio_path
                if narration_path:
                    logger.info("Using original audio: %s", narration_path)
                else:
                    logger.info("No original audio available (PDF input?)")
            elif args.audio == "custom":
                if not args.audio_file:
                    logger.error("--audio-file required when --audio custom")
                    sys.exit(1)
                narration_path = args.audio_file
                logger.info("Using custom audio: %s", narration_path)
            elif args.audio == "tts":
                logger.info("TTS generation handled interactively via generate_tts.py")
                tts_dir = os.path.join(project_dir, "audio", "tts")
                narration_file = os.path.join(tts_dir, "narration.mp3")
                if os.path.exists(narration_file):
                    narration_path = narration_file
                    logger.info("Found existing TTS: %s", narration_path)
                else:
                    logger.info("No TTS found. Generate with generate_tts.py,")
                    logger.info("then resume with: --resume-from 6")
                    if not args.dry_run:
                        return

        # Save audio setting to slides.json
        if not args.dry_run and slides_data:
            slides_data.setdefault("settings", {})
            audio_source = "narration-driven" if args.narration_driven else args.audio
            slides_data["settings"]["audio_source"] = audio_source
            if narration_path:
                slides_data["settings"]["audio_path"] = narration_path
            save_slides_json(project_dir, slides_data)

    # Phase 5.5: Presenter character intro/outro (optional)
    presenter_intro_video = None
    presenter_outro_video = None
    if args.presenter_character:
        # Parse --scene-numbers if provided
        scene_nums = None
        if args.scene_numbers:
            parts = [int(x.strip()) for x in args.scene_numbers.split(",")]
            if len(parts) >= 2:
                scene_nums = (parts[0], parts[1])
            else:
                logger.error("--scene-numbers requires 2 comma-separated values (intro,outro)")
                sys.exit(1)

        presenter_intro_video, presenter_outro_video = phase_presenter_character(
            project_dir,
            character_id=args.presenter_character,
            intro_dialogue=args.presenter_intro,
            outro_dialogue=args.presenter_outro,
            voice_id=args.presenter_voice_id,
            scene_numbers=scene_nums,
            quality=args.quality,
            dry_run=args.dry_run,
            yes=args.yes,
        )

    if start_phase <= 6:
        phase6_stitch(
            project_dir,
            args.animation,
            narration_path=narration_path,
            transition=args.transition,
            transition_duration=args.transition_duration,
            logo_intro=presenter_intro_video,
            logo_outro=presenter_outro_video,
            dry_run=args.dry_run,
        )

    logger.info("=" * 60)
    logger.info("PRESENTATION Mode Complete")
    logger.info("=" * 60)
    logger.info("Project: %s", os.path.basename(project_dir))
    logger.info("Animation: %s", args.animation)
    logger.info("Audio: %s", args.audio)
    final_dir = os.path.join(project_dir, "final")
    if os.path.isdir(final_dir):
        for f in sorted(os.listdir(final_dir)):
            if f.endswith(".mp4"):
                fpath = os.path.join(final_dir, f)
                size_mb = os.path.getsize(fpath) / 1024 / 1024
                logger.info("Output: %s (%.1f MB)", fpath, size_mb)
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
