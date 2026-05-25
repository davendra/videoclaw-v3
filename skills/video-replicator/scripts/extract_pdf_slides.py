#!/usr/bin/env python3
"""
Extract slides from a PDF file as images and generate slides.json.

Converts each PDF page to a JPEG image using pdf2image (wraps pdftoppm).
Also copies images to images/scene_N_frame.jpg for the downstream pipeline.

Usage:
    # Basic extraction with equal duration
    python extract_pdf_slides.py \
      --pdf "slides.pdf" \
      --output-dir "projects/{slug}/slides" \
      --output-json "projects/{slug}/analysis/slides.json" \
      --total-duration 120

    # Custom DPI
    python extract_pdf_slides.py \
      --pdf "slides.pdf" \
      --output-dir "projects/{slug}/slides" \
      --output-json "projects/{slug}/analysis/slides.json" \
      --dpi 300

    # Dry-run (check PDF page count without converting)
    python extract_pdf_slides.py \
      --pdf "slides.pdf" --dry-run
"""

import argparse
import json
import os
import shutil
import sys


def convert_pdf_to_images(
    pdf_path: str,
    output_dir: str,
    dpi: int = 200,
) -> list[str]:
    """Convert PDF pages to JPEG images. Returns list of output paths."""
    try:
        from pdf2image import convert_from_path
    except ImportError:
        print("Error: pdf2image not installed. Run: pip install pdf2image")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    print(f"  Converting PDF at {dpi} DPI...")
    images = convert_from_path(pdf_path, dpi=dpi, fmt="jpeg")

    output_paths = []
    for i, image in enumerate(images, start=1):
        filename = f"slide_{i:03d}.jpg"
        filepath = os.path.join(output_dir, filename)
        image.save(filepath, "JPEG", quality=95)
        output_paths.append(filepath)

    return output_paths


def get_pdf_page_count(pdf_path: str) -> int:
    """Get page count without full conversion."""
    try:
        from pdf2image import pdfinfo_from_path
        info = pdfinfo_from_path(pdf_path)
        return info.get("Pages", 0)
    except Exception:
        # Fallback: convert first page only to check
        try:
            from pdf2image import convert_from_path
            images = convert_from_path(pdf_path, first_page=1, last_page=1)
            return len(images) if images else 0
        except Exception:
            return 0


def generate_slides_json(
    image_paths: list[str],
    pdf_path: str,
    total_duration: float | None = None,
    default_per_slide: float = 8.0,
) -> dict:
    """Generate slides.json with equal durations."""
    num_slides = len(image_paths)

    if total_duration and total_duration > 0:
        per_slide_duration = total_duration / num_slides
    else:
        per_slide_duration = default_per_slide
        total_duration = per_slide_duration * num_slides

    slides = []
    current_time = 0.0
    for i, image_path in enumerate(image_paths, start=1):
        slides.append({
            "slide": i,
            "timestamp": f"{int(current_time // 60):02d}:{current_time % 60:05.2f}",
            "timestamp_seconds": round(current_time, 2),
            "duration": round(per_slide_duration, 2),
            "image": os.path.basename(image_path),
            "status": "detected",
        })
        current_time += per_slide_duration

    return {
        "source_type": "pdf",
        "source_file": os.path.abspath(pdf_path),
        "source_duration": round(total_duration, 2),
        "total_slides": num_slides,
        "slides": slides,
        "settings": {},
    }


def extract_single_page(
    pdf_path: str,
    page_num: int,
    output_dir: str,
    dpi: int = 200,
) -> str:
    """Re-extract a single page from PDF after nano-pdf edit.

    page_num is 1-based. Overwrites existing slide image.
    Returns the output file path.
    """
    try:
        from pdf2image import convert_from_path
    except ImportError:
        print("Error: pdf2image not installed. Run: pip install pdf2image")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    images = convert_from_path(
        pdf_path, dpi=dpi, fmt="jpeg",
        first_page=page_num, last_page=page_num,
    )
    if not images:
        print(f"Error: Could not extract page {page_num} from {pdf_path}")
        sys.exit(1)

    filename = f"slide_{page_num:03d}.jpg"
    filepath = os.path.join(output_dir, filename)
    images[0].save(filepath, "JPEG", quality=95)
    print(f"  Re-extracted page {page_num} -> {filepath}")
    return filepath


def copy_to_images_dir(image_paths: list[str], project_dir: str) -> list[str]:
    """Copy slide images to images/ as scene_N_frame.jpg for downstream pipeline."""
    images_dir = os.path.join(project_dir, "images")
    os.makedirs(images_dir, exist_ok=True)

    copied = []
    for i, src in enumerate(image_paths, start=1):
        dst = os.path.join(images_dir, f"scene_{i}_frame.jpg")
        shutil.copy2(src, dst)
        copied.append(dst)

    return copied


def main():
    parser = argparse.ArgumentParser(
        description="Extract slides from a PDF file as images"
    )
    parser.add_argument("--pdf", required=True, help="Path to PDF file")
    parser.add_argument("--output-dir", help="Directory for extracted slide images")
    parser.add_argument("--output-json", help="Path for slides.json output")
    parser.add_argument("--total-duration", type=float,
                        help="Total video duration in seconds (divided equally among slides)")
    parser.add_argument("--dpi", type=int, default=200,
                        help="Render DPI for PDF pages (default: 200)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview page count without converting")

    args = parser.parse_args()

    pdf_path = os.path.abspath(args.pdf)
    if not os.path.exists(pdf_path):
        print(f"Error: PDF not found: {pdf_path}")
        sys.exit(1)

    print(f"\n{'='*60}")
    print("PDF Slide Extraction")
    print(f"{'='*60}")
    print(f"PDF: {pdf_path}")

    # Dry run: just show page count
    if args.dry_run:
        count = get_pdf_page_count(pdf_path)
        print(f"Pages: {count}")
        if args.total_duration:
            per_slide = args.total_duration / max(count, 1)
            print(f"Duration: {args.total_duration}s total, {per_slide:.1f}s per slide")
        else:
            print(f"Duration: {8.0 * count}s total (8s default per slide)")
        print("\nDry run complete.")
        return

    # Resolve output directories
    output_dir = args.output_dir
    if not output_dir:
        print("Error: --output-dir is required (not in dry-run mode)")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    # Convert PDF to images
    image_paths = convert_pdf_to_images(pdf_path, output_dir, dpi=args.dpi)
    print(f"  Extracted {len(image_paths)} slides to {output_dir}")

    # Generate slides.json
    slides_data = generate_slides_json(
        image_paths, pdf_path,
        total_duration=args.total_duration,
    )

    # Write slides.json
    output_json = args.output_json
    if output_json:
        os.makedirs(os.path.dirname(os.path.abspath(output_json)), exist_ok=True)
        with open(output_json, "w") as f:
            json.dump(slides_data, f, indent=2)
        print(f"  slides.json: {output_json}")

    # Copy to images/ directory (infer project dir from output-dir)
    # output-dir is typically projects/{slug}/slides
    project_dir = os.path.dirname(output_dir)
    if os.path.basename(output_dir) == "slides":
        copied = copy_to_images_dir(image_paths, project_dir)
        print(f"  Copied {len(copied)} images to {os.path.join(project_dir, 'images')}")

    print(f"\n{'='*60}")
    print(f"Extracted {len(image_paths)} slides")
    if args.total_duration:
        per_slide = args.total_duration / len(image_paths)
        print(f"Duration: {args.total_duration}s total, {per_slide:.1f}s per slide")
    else:
        print(f"Duration: {8.0 * len(image_paths)}s total (8s default per slide)")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
