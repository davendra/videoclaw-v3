#!/usr/bin/env python3
"""
Pre-flight validation orchestration.

Extracted from utils.py — runs comprehensive checks before video
generation (project dirs, images, veo-cli, dependencies, API keys).
"""

import os
import subprocess

from utils_image import validate_aspect_ratios


def validate_preflight(
    project_base: str,
    product_name: str,
    mode: str = "i2v",
    check_images: bool = True,
    check_veo: bool = True,
    veo_path: str = None,
) -> dict:
    """
    Run pre-flight validation before generation.

    Checks: project dirs, image aspect ratios, veo-cli, Bun, FFmpeg, API keys.

    Returns:
        {"passed": bool, "checks": [{"name": str, "passed": bool, "message": str}]}
    """
    checks = []

    # Check project directory
    project_dir = os.path.join(project_base, product_name)
    try:
        os.makedirs(project_dir, exist_ok=True)
        checks.append({
            "name": "project_directory",
            "passed": True,
            "message": f"Project directory writable: {project_dir}"
        })
    except Exception as e:
        checks.append({
            "name": "project_directory",
            "passed": False,
            "message": f"Cannot create project directory: {e}"
        })

    # Check images (for I2V mode)
    if check_images and mode.lower() in ("i2v", "frames-to-video"):
        images_dir = os.path.join(project_dir, "images")
        if os.path.exists(images_dir):
            image_files = [
                os.path.join(images_dir, f)
                for f in os.listdir(images_dir)
                if f.endswith((".png", ".jpg", ".jpeg", ".webp"))
            ]
            if image_files:
                ratio_check = validate_aspect_ratios(image_files)
                if ratio_check["consistent"]:
                    checks.append({
                        "name": "image_aspect_ratios",
                        "passed": True,
                        "message": f"Images consistent: {ratio_check['detected_ratio']} ({len(image_files)} files)"
                    })
                else:
                    checks.append({
                        "name": "image_aspect_ratios",
                        "passed": False,
                        "message": f"Mixed aspect ratios: {ratio_check['errors']}"
                    })
            else:
                checks.append({
                    "name": "images_exist",
                    "passed": False,
                    "message": f"No images found in {images_dir}"
                })
        else:
            checks.append({
                "name": "images_dir",
                "passed": False,
                "message": f"Images directory not found: {images_dir}"
            })

    # Check veo-cli
    if check_veo and veo_path:
        veo_google_ts = os.path.join(veo_path, "google.ts")
        veo_cookie = os.path.join(veo_path, "cookie.json")

        if os.path.exists(veo_google_ts):
            checks.append({
                "name": "veo_cli",
                "passed": True,
                "message": f"veo-cli found: {veo_path}"
            })
        else:
            checks.append({
                "name": "veo_cli",
                "passed": False,
                "message": f"veo-cli not found: {veo_google_ts}"
            })

        if os.path.exists(veo_cookie):
            checks.append({
                "name": "veo_cookie",
                "passed": True,
                "message": "cookie.json found"
            })
        else:
            checks.append({
                "name": "veo_cookie",
                "passed": False,
                "message": "cookie.json missing - run veo-cli with --visible to log in"
            })

    # Check Bun
    try:
        result = subprocess.run(
            ["bun", "--version"],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            checks.append({
                "name": "bun",
                "passed": True,
                "message": f"Bun installed: v{result.stdout.strip()}"
            })
        else:
            checks.append({
                "name": "bun",
                "passed": False,
                "message": "Bun not working properly"
            })
    except FileNotFoundError:
        checks.append({
            "name": "bun",
            "passed": False,
            "message": "Bun not installed. Run: brew install oven-sh/bun/bun"
        })
    except Exception:
        pass

    # Check FFmpeg
    try:
        result = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            checks.append({
                "name": "ffmpeg",
                "passed": True,
                "message": "FFmpeg installed"
            })
    except FileNotFoundError:
        checks.append({
            "name": "ffmpeg",
            "passed": False,
            "message": "FFmpeg not installed. Run: brew install ffmpeg"
        })
    except Exception:
        pass

    # Check API keys
    if os.environ.get("GOOGLE_API_KEY"):
        checks.append({
            "name": "google_api_key",
            "passed": True,
            "message": "GOOGLE_API_KEY set"
        })
    else:
        checks.append({
            "name": "google_api_key",
            "passed": False,
            "message": "GOOGLE_API_KEY not set (needed for analysis)"
        })

    return {
        "passed": all(c["passed"] for c in checks),
        "checks": checks
    }


def print_preflight_results(results: dict) -> None:
    """Print pre-flight validation results."""
    print(f"\n{'='*60}")
    print("Pre-Flight Validation")
    print(f"{'='*60}")

    for check in results["checks"]:
        status = "OK" if check["passed"] else "FAIL"
        print(f"  {status} {check['message']}")

    print(f"{'='*60}")
    if results["passed"]:
        print("All checks passed")
    else:
        print("Some checks failed - fix issues before proceeding")
    print(f"{'='*60}\n")
