#!/usr/bin/env python3
"""
Music Generation Script using Suno AI via Kie.ai API
Generates background music tracks based on video analysis.

Usage:
    python generate_music.py \
        --prompt "Minimal electronic, 95 BPM, luxury brand feel" \
        --duration 30 \
        --output "background.mp3"

    # With retry and fallback
    python generate_music.py \
        --prompt "Cinematic orchestral, 120 BPM, D minor, strings and brass" \
        --duration 30 \
        --output "background.mp3" \
        --max-music-retries 3 \
        --music-fallback-prompt "Calm cinematic background music"

Environment:
    KIE_API_KEY - Required for Kie.ai / Suno API access
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))

from config import (
    KIE_API_BASE,
    MUSIC_MAX_RETRIES,
    MUSIC_RETRY_BACKOFF,
    MUSIC_POLL_INTERVAL,
    MUSIC_POLL_MAX_ATTEMPTS,
    MUSIC_POLL_TIMEOUT_MULTIPLIER,
    MUSIC_RETRYABLE_ERRORS,
)
from exceptions import APIError


def simplify_music_prompt(prompt: str) -> str:
    """Simplify a music prompt by removing specific technical details.

    Strips tempo (BPM), key signatures, specific instrument names,
    and time signatures. Keeps mood/genre descriptors.

    Args:
        prompt: Original music prompt with technical details.

    Returns:
        Simplified prompt with mood/genre only.

    Examples:
        >>> simplify_music_prompt("Cinematic orchestral, 120 BPM, D minor, strings and brass")
        'Cinematic orchestral'
        >>> simplify_music_prompt("Upbeat electronic, 128 BPM, A major, synths, drums, bass")
        'Upbeat electronic'
    """
    simplified = prompt

    # Remove BPM references (e.g., "120 BPM", "95bpm", "at 120 BPM")
    simplified = re.sub(r',?\s*(?:at\s+)?\d+\s*(?:BPM|bpm)\b', '', simplified)

    # Remove key signatures (e.g., "D minor", "A major", "C# minor", "Bb major",
    #   "key of D minor", "in D minor")
    simplified = re.sub(
        r',?\s*(?:(?:key\s+of|in)\s+)?[A-G][#b]?\s*(?:minor|major|min|maj)\b',
        '', simplified, flags=re.IGNORECASE
    )

    # Remove time signatures (e.g., "4/4 time", "3/4", "6/8 time signature")
    simplified = re.sub(
        r',?\s*\d+/\d+\s*(?:time(?:\s+signature)?)?\b',
        '', simplified, flags=re.IGNORECASE
    )

    # Remove specific instrument lists (e.g., "strings and brass",
    #   "synths, drums, bass", "with piano and guitar")
    # Common instruments to strip
    instruments = (
        r'(?:strings?|brass|synths?|synthesizer|drums?|bass|piano|guitar|'
        r'violin|cello|flute|trumpet|saxophone|harp|organ|percussion|'
        r'kick|snare|hi-hat|808|pad|arp|lead)'
    )
    # Remove "with <instruments>" or standalone instrument lists
    simplified = re.sub(
        rf',?\s*(?:with\s+)?{instruments}(?:\s*(?:,|and)\s*{instruments})*',
        '', simplified, flags=re.IGNORECASE
    )

    # Clean up leftover commas, double spaces, trailing/leading whitespace
    simplified = re.sub(r'\s*,\s*,\s*', ', ', simplified)
    simplified = re.sub(r'\s+', ' ', simplified)
    simplified = simplified.strip(' ,')

    return simplified if simplified else prompt


def _extract_mood(prompt: str) -> str:
    """Extract the primary mood/genre keyword from a prompt.

    Takes the first meaningful word(s) before any comma or technical detail.

    Args:
        prompt: Music prompt string.

    Returns:
        Short mood descriptor (e.g., "Cinematic", "Upbeat electronic").
    """
    # Take text up to the first comma or end
    mood = prompt.split(',')[0].strip()

    # If that's too long, take first two words
    words = mood.split()
    if len(words) > 3:
        mood = ' '.join(words[:2])

    return mood if mood else "ambient"


def generate_music(
    prompt: str,
    duration: int,
    api_key: str,
    max_poll_attempts: int = MUSIC_POLL_MAX_ATTEMPTS,
) -> dict:
    """Generate music using Kie.ai Suno API v1.

    Args:
        prompt: Music description (max 500 chars for non-custom mode).
        duration: Desired duration in seconds.
        api_key: Kie.ai API key.
        max_poll_attempts: Maximum number of status poll attempts.

    Returns:
        Dict with 'tracks' (list of suno track dicts) and 'task_id'.

    Raises:
        APIError: On API errors, generation failures, or timeout.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    # Create generation request using v1 API
    # Using non-custom mode for simpler usage (prompt only, max 500 chars)
    payload = {
        "prompt": prompt[:500],  # Max 500 chars for non-custom mode
        "customMode": False,
        "instrumental": True,  # Background music without vocals
        "model": "V5",  # Latest model
        "callBackUrl": "https://httpbin.org/post"  # Dummy callback (we'll poll instead)
    }

    print("Generating music...")
    print(f"Prompt: {prompt[:100]}...")
    print("Model: V5 (instrumental)")

    # Submit generation request
    response = requests.post(
        f"{KIE_API_BASE}/api/v1/generate",
        headers=headers,
        json=payload
    )

    if response.status_code != 200:
        raise APIError(f"API error: {response.status_code} - {response.text}")

    result = response.json()

    if result.get("code") != 200:
        raise APIError(f"API error: {result.get('msg', 'Unknown error')}")

    task_id = result.get("data", {}).get("taskId")

    if not task_id:
        raise APIError(f"No taskId in response: {result}")

    print(f"Task ID: {task_id}")
    print(f"Waiting for generation to complete (max {max_poll_attempts} polls)...")

    # Poll for completion using record-info endpoint
    # Docs: https://docs.kie.ai/suno-api/generate-music
    for attempt in range(max_poll_attempts):
        time.sleep(MUSIC_POLL_INTERVAL)

        status_response = requests.get(
            f"{KIE_API_BASE}/api/v1/generate/record-info",
            headers=headers,
            params={"taskId": task_id}
        )

        if status_response.status_code != 200:
            print(f"Status check failed: {status_response.status_code}")
            continue

        status = status_response.json()

        if status.get("code") != 200:
            print(f"Status: waiting... (attempt {attempt + 1}/{max_poll_attempts})")
            continue

        data = status.get("data", {})

        # Check status field - "SUCCESS" means generation is complete
        gen_status = data.get("status", "")
        if gen_status == "SUCCESS":
            # Get tracks from response.sunoData
            suno_data = data.get("response", {}).get("sunoData", [])
            if suno_data and len(suno_data) > 0:
                print("Generation complete!")
                return {"tracks": suno_data, "task_id": task_id}

        # Also check for error status
        if gen_status == "FAILED":
            error_msg = data.get("errorMessage", "Unknown error")
            raise APIError(f"Generation failed: {error_msg}")

        # Check for GENERATE_AUDIO_FAILED in any field
        data_str = json.dumps(data)
        if "GENERATE_AUDIO_FAILED" in data_str:
            raise APIError("Generation failed: GENERATE_AUDIO_FAILED")

        print(f"Status: {gen_status or 'pending'}... (attempt {attempt + 1}/{max_poll_attempts})")

    raise APIError("Generation timed out")


def _is_retryable_error(error: Exception) -> bool:
    """Check if an error is retryable based on known patterns.

    Args:
        error: The exception to check.

    Returns:
        True if the error matches a retryable pattern.
    """
    error_str = str(error).lower()
    return any(pattern.lower() in error_str for pattern in MUSIC_RETRYABLE_ERRORS)


def generate_music_with_retry(
    prompt: str,
    duration: int,
    api_key: str,
    max_retries: int = MUSIC_MAX_RETRIES,
    fallback_prompt: str | None = None,
) -> dict:
    """Generate music with retry logic and prompt simplification.

    Retry strategy:
        - Attempt 1: Original prompt, normal timeout
        - Attempt 2: Simplified prompt (mood/genre only), 2x timeout
        - Attempt 3: Fallback prompt or ultra-simple "Background music, {mood}", 2x timeout

    Args:
        prompt: Original music description.
        duration: Desired duration in seconds.
        api_key: Kie.ai API key.
        max_retries: Maximum number of retry attempts (0 disables retry).
        fallback_prompt: Alternative prompt to use on final retry.

    Returns:
        Dict with 'tracks' and 'task_id'.

    Raises:
        APIError: If all attempts fail.
    """
    total_attempts = 1 + max_retries
    last_error = None

    for attempt_num in range(total_attempts):
        # Determine which prompt to use
        if attempt_num == 0:
            current_prompt = prompt
        elif attempt_num == total_attempts - 1 and total_attempts > 2:
            # Final attempt: use fallback if provided, else ultra-simple
            if fallback_prompt:
                current_prompt = fallback_prompt
            else:
                mood = _extract_mood(prompt)
                current_prompt = f"Background music, {mood}"
        else:
            # Middle attempt(s): simplified prompt
            current_prompt = simplify_music_prompt(prompt)

        # Increase poll attempts on retries
        if attempt_num == 0:
            max_poll = MUSIC_POLL_MAX_ATTEMPTS
        else:
            max_poll = MUSIC_POLL_MAX_ATTEMPTS * MUSIC_POLL_TIMEOUT_MULTIPLIER

        # Log the attempt
        if attempt_num > 0:
            backoff_idx = min(attempt_num - 1, len(MUSIC_RETRY_BACKOFF) - 1)
            backoff = MUSIC_RETRY_BACKOFF[backoff_idx]
            print(
                f"\nMusic generation timed out or failed. "
                f"Retrying with {'simplified' if attempt_num < total_attempts - 1 else 'fallback'} prompt "
                f"(attempt {attempt_num + 1}/{total_attempts})..."
            )
            print(f"Waiting {backoff}s before retry...")
            time.sleep(backoff)
            print(f"Retry prompt: {current_prompt[:100]}...")

        try:
            return generate_music(
                current_prompt, duration, api_key, max_poll_attempts=max_poll
            )
        except APIError as e:
            last_error = e
            if not _is_retryable_error(e):
                # Non-retryable error — raise immediately
                raise
            if attempt_num >= total_attempts - 1:
                # Last attempt — raise with context
                break
            # Retryable error — continue to next attempt
            print(f"Error on attempt {attempt_num + 1}: {e}")

    # All attempts exhausted
    raise APIError(
        f"All {total_attempts} music generation attempts failed. "
        f"Last error: {last_error}. "
        f"Try a simpler prompt or use --music-fallback-prompt."
    )


def download_audio(url: str, output_path: str) -> str:
    """Download audio file from URL."""
    print(f"Downloading audio to: {output_path}")

    response = requests.get(url, stream=True)
    response.raise_for_status()

    # Ensure directory exists
    os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else ".", exist_ok=True)

    with open(output_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)

    print(f"Downloaded: {output_path}")
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Generate background music using Suno AI")
    parser.add_argument("--prompt", required=True, help="Music description prompt")
    parser.add_argument("--duration", type=int, default=30, help="Duration in seconds (default: 30)")
    parser.add_argument("--output", required=True, help="Output audio file path")
    parser.add_argument(
        "--max-music-retries", type=int, default=MUSIC_MAX_RETRIES,
        help=f"Max retry attempts on timeout/failure (default: {MUSIC_MAX_RETRIES}, 0 disables retry)"
    )
    parser.add_argument(
        "--music-fallback-prompt", type=str, default=None,
        help="Alternative prompt to use when primary prompt fails on final retry"
    )
    args = parser.parse_args()

    # Get API key
    api_key = os.environ.get("KIE_API_KEY")
    if not api_key:
        print("Error: KIE_API_KEY environment variable not set")
        print("\nTo get an API key:")
        print("1. Sign up at https://kie.ai")
        print("2. Get your API key from the dashboard")
        print("3. Set: export KIE_API_KEY='your-key-here'")
        sys.exit(1)

    try:
        result = generate_music_with_retry(
            args.prompt,
            args.duration,
            api_key,
            max_retries=args.max_music_retries,
            fallback_prompt=args.music_fallback_prompt,
        )

        # Get the audio URL from result (Kie.ai v1 API format)
        tracks = result.get("tracks", [])
        audio_url = None

        if tracks and len(tracks) > 0:
            # Field is 'audioUrl' not 'audio_url' in Kie.ai response
            audio_url = tracks[0].get("audioUrl")
            print(f"Track title: {tracks[0].get('title', 'Unknown')}")
            print(f"Duration: {tracks[0].get('duration', 'Unknown')}s")
            print(f"Tags: {tracks[0].get('tags', 'N/A')}")

        if audio_url:
            download_audio(audio_url, args.output)
            print(f"\nSuccess! Audio saved to: {args.output}")
        else:
            print(f"Warning: Could not find audio URL in response: {json.dumps(result, indent=2)}")
            sys.exit(1)

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
