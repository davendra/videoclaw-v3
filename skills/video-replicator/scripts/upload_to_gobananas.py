#!/usr/bin/env python3
"""
Upload local images to Go Bananas and create character/product references.

Handles the tedious workflow of:
1. Converting images to PNG format (Go Bananas requires specific MIME types)
2. Uploading to a public host (freeimage.host, imgbb.com, catbox.moe)
3. Creating Go Bananas character or product references

Usage:
    # Upload and create a character reference
    python upload_to_gobananas.py \
        --type character \
        --name "Sofia" \
        --image "./input/model.webp" \
        --description "Young woman, long blonde hair, beach casual style" \
        --base-prompt "Sofia, young woman with long flowing blonde hair, beach casual style"

    # Upload and create a product reference
    python upload_to_gobananas.py \
        --type product \
        --name "GoldSandals" \
        --image "./input/sandals.jpg" \
        --description "Gold strappy sandals with rhinestone details, 3-inch heel"

    # Upload only (returns hosted URL and image_id)
    python upload_to_gobananas.py \
        --upload-only \
        --image "./input/photo.png"

    # Batch upload from JSON config
    python upload_to_gobananas.py \
        --config "./assets.json"

Environment:
    GO_BANANAS_API_KEY - Required for REST API uploads (optional, uses MCP if not set)
    IMGBB_API_KEY - Optional, for imgbb.com hosting (free tier available)

Requirements:
    pip install requests pillow
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))

from exceptions import ImageProcessingError, MissingDependencyError

# ============================================================================
# Configuration
# ============================================================================

# Image hosting options (in order of preference)
IMAGE_HOSTS = {
    "catbox": {
        "url": "https://catbox.moe/user/api.php",
        "max_size_mb": 200,
        "requires_key": False,
    },
    "imgbb": {
        "url": "https://api.imgbb.com/1/upload",
        "max_size_mb": 32,
        "requires_key": True,
        "key_env": "IMGBB_API_KEY",
    },
    "freeimage": {
        "url": "https://freeimage.host/api/1/upload",
        "max_size_mb": 6,
        "requires_key": True,
        "key_env": "FREEIMAGE_API_KEY",
    },
}

# Supported input formats
SUPPORTED_FORMATS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff"}

# Go Bananas API (used when REST API is available)
GO_BANANAS_API_URL = "https://gobananasai.com/api"


# ============================================================================
# Image Conversion
# ============================================================================


def get_image_format(path: str) -> str | None:
    """Detect image format from file extension."""
    ext = Path(path).suffix.lower()
    return ext if ext in SUPPORTED_FORMATS else None


def convert_to_png(input_path: str, output_path: str | None = None) -> str:
    """
    Convert image to PNG format using sips (macOS) or PIL.

    Args:
        input_path: Path to input image
        output_path: Optional output path. If None, creates temp file.

    Returns:
        Path to converted PNG file
    """
    if output_path is None:
        fd, output_path = tempfile.mkstemp(suffix=".png")
        os.close(fd)

    input_ext = Path(input_path).suffix.lower()

    # If already PNG, just copy
    if input_ext == ".png":
        if input_path != output_path:
            import shutil
            shutil.copy2(input_path, output_path)
        return output_path

    # Try sips first (macOS native, fast)
    try:
        result = subprocess.run(
            ["sips", "-s", "format", "png", input_path, "--out", output_path],
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode == 0 and os.path.exists(output_path):
            return output_path
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Fallback to PIL
    try:
        from PIL import Image
        with Image.open(input_path) as img:
            # Convert to RGB if necessary (handles RGBA, P modes)
            img = img.convert("RGBA") if img.mode in ("RGBA", "P") else img.convert("RGB")
            img.save(output_path, "PNG")
        return output_path
    except ImportError as exc:
        raise MissingDependencyError("PIL not installed. Run: pip install pillow") from exc
    except Exception as e:
        raise ImageProcessingError(f"Failed to convert image: {e}") from e


def get_image_dimensions(path: str) -> tuple | None:
    """Get image dimensions (width, height)."""
    # Try sips first
    try:
        result = subprocess.run(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            lines = result.stdout.strip().split("\n")
            width = height = None
            for line in lines:
                if "pixelWidth" in line:
                    width = int(line.split()[-1])
                elif "pixelHeight" in line:
                    height = int(line.split()[-1])
            if width and height:
                return (width, height)
    except Exception:
        pass

    # Fallback to PIL
    try:
        from PIL import Image
        with Image.open(path) as img:
            return img.size
    except Exception:
        pass

    return None


# ============================================================================
# Image Hosting
# ============================================================================


def upload_to_catbox(file_path: str) -> str | None:
    """Upload image to catbox.moe (no API key needed)."""
    try:
        with open(file_path, "rb") as f:
            response = requests.post(
                "https://catbox.moe/user/api.php",
                data={"reqtype": "fileupload"},
                files={"fileToUpload": (Path(file_path).name, f, "image/png")},
                timeout=60
            )

        if response.status_code == 200 and response.text.startswith("https://"):
            return response.text.strip()
    except Exception as e:
        print(f"  Warning: catbox.moe upload failed: {e}")

    return None


def upload_to_imgbb(file_path: str, api_key: str) -> str | None:
    """Upload image to imgbb.com."""
    try:
        import base64

        with open(file_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode()

        response = requests.post(
            "https://api.imgbb.com/1/upload",
            data={
                "key": api_key,
                "image": image_data,
                "name": Path(file_path).stem,
            },
            timeout=60
        )

        if response.status_code == 200:
            data = response.json()
            if data.get("success"):
                return data["data"]["url"]
    except Exception as e:
        print(f"  Warning: imgbb.com upload failed: {e}")

    return None


def upload_to_freeimage(file_path: str, api_key: str) -> str | None:
    """Upload image to freeimage.host."""
    try:
        import base64

        with open(file_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode()

        response = requests.post(
            "https://freeimage.host/api/1/upload",
            data={
                "key": api_key,
                "source": image_data,
                "format": "json",
            },
            timeout=60
        )

        if response.status_code == 200:
            data = response.json()
            if data.get("status_code") == 200:
                return data["image"]["url"]
    except Exception as e:
        print(f"  Warning: freeimage.host upload failed: {e}")

    return None


def host_image(file_path: str) -> str | None:
    """
    Upload image to a public host.

    Tries hosts in order: catbox (no key), imgbb (if key), freeimage (if key).

    Returns:
        Public URL to the hosted image, or None if all hosts fail.
    """
    # Ensure PNG format
    if not file_path.lower().endswith(".png"):
        print("  Converting to PNG...")
        png_path = convert_to_png(file_path)
    else:
        png_path = file_path

    print("  Uploading to image host...")

    # Try catbox first (no API key needed)
    url = upload_to_catbox(png_path)
    if url:
        print(f"  Hosted at: {url}")
        return url

    # Try imgbb if key available
    imgbb_key = os.environ.get("IMGBB_API_KEY")
    if imgbb_key:
        url = upload_to_imgbb(png_path, imgbb_key)
        if url:
            print(f"  Hosted at: {url}")
            return url

    # Try freeimage if key available
    freeimage_key = os.environ.get("FREEIMAGE_API_KEY")
    if freeimage_key:
        url = upload_to_freeimage(png_path, freeimage_key)
        if url:
            print(f"  Hosted at: {url}")
            return url

    print("  ERROR: All image hosts failed. Try setting IMGBB_API_KEY.")
    return None


# ============================================================================
# Go Bananas Integration
# ============================================================================


def upload_to_gobananas_api(image_url: str, api_key: str) -> dict | None:
    """
    Upload image to Go Bananas using REST API.

    Note: This uploads via URL, not direct file upload.
    The image must be hosted first.

    Returns:
        {"image_id": int, "url": str} on success, None on failure.
    """
    try:
        headers = {
            "X-API-Key": api_key,
            "Content-Type": "application/json",
        }

        response = requests.post(
            f"{GO_BANANAS_API_URL}/images/upload",
            headers=headers,
            json={"image_url": image_url},
            timeout=60
        )

        if response.status_code == 200:
            data = response.json()
            return {
                "image_id": data.get("image_id"),
                "url": data.get("url"),
            }
        else:
            print(f"  Warning: Go Bananas API returned {response.status_code}: {response.text[:200]}")
    except Exception as e:
        print(f"  Warning: Go Bananas API upload failed: {e}")

    return None


def create_character_reference(
    name: str,
    base_prompt: str,
    description: str,
    image_id: int,
    api_key: str
) -> dict | None:
    """
    Create a Go Bananas character reference.

    Returns:
        {"character_id": int, "name": str} on success, None on failure.
    """
    try:
        headers = {
            "X-API-Key": api_key,
            "Content-Type": "application/json",
        }

        response = requests.post(
            f"{GO_BANANAS_API_URL}/characters",
            headers=headers,
            json={
                "character_name": name,
                "base_prompt": base_prompt,
                "description": description,
                "reference_image_ids": [image_id],
            },
            timeout=30
        )

        if response.status_code in (200, 201):
            data = response.json()
            return {
                "character_id": data.get("id") or data.get("character_id"),
                "name": name,
            }
        else:
            print(f"  Warning: Failed to create character: {response.status_code} - {response.text[:200]}")
    except Exception as e:
        print(f"  Warning: Create character failed: {e}")

    return None


def create_product_reference(
    name: str,
    description: str,
    image_url: str,
    api_key: str
) -> dict | None:
    """
    Create a Go Bananas product reference.

    Note: Products use image URL, not image ID.

    Returns:
        {"product_id": int, "name": str} on success, None on failure.
    """
    try:
        headers = {
            "X-API-Key": api_key,
            "Content-Type": "application/json",
        }

        response = requests.post(
            f"{GO_BANANAS_API_URL}/products",
            headers=headers,
            json={
                "product_name": name,
                "product_description": description,
                "product_url": image_url,
            },
            timeout=30
        )

        if response.status_code in (200, 201):
            data = response.json()
            return {
                "product_id": data.get("id") or data.get("product_id"),
                "name": name,
            }
        else:
            print(f"  Warning: Failed to create product: {response.status_code} - {response.text[:200]}")
    except Exception as e:
        print(f"  Warning: Create product failed: {e}")

    return None


# ============================================================================
# Main Workflow Functions
# ============================================================================


def upload_and_create_character(
    image_path: str,
    name: str,
    base_prompt: str,
    description: str,
    api_key: str | None = None
) -> dict:
    """
    Full workflow: Host image -> Upload to Go Bananas -> Create character.

    Args:
        image_path: Local path to character reference image
        name: Character name (for Go Bananas reference)
        base_prompt: Detailed prompt describing character appearance
        description: Short description
        api_key: Go Bananas API key (uses env var if not provided)

    Returns:
        {
            "success": bool,
            "hosted_url": str,
            "image_id": int,
            "character_id": int,
            "name": str,
            "error": str (if failed)
        }
    """
    result = {
        "success": False,
        "hosted_url": None,
        "image_id": None,
        "character_id": None,
        "name": name,
        "error": None,
    }

    api_key = api_key or os.environ.get("GO_BANANAS_API_KEY")

    print(f"\n{'='*60}")
    print(f"Creating character: {name}")
    print(f"{'='*60}")

    # Step 1: Host image
    print(f"\n[1/3] Hosting image: {image_path}")
    hosted_url = host_image(image_path)
    if not hosted_url:
        result["error"] = "Failed to host image"
        return result
    result["hosted_url"] = hosted_url

    # Step 2: Upload to Go Bananas (if API key available)
    if api_key:
        print("\n[2/3] Uploading to Go Bananas...")
        gb_result = upload_to_gobananas_api(hosted_url, api_key)
        if gb_result:
            result["image_id"] = gb_result["image_id"]
            print(f"  Image ID: {result['image_id']}")
        else:
            print("  Note: Using MCP upload instead (no REST API)")
    else:
        print("\n[2/3] No API key - use MCP tools:")
        print("  mcp__go-bananas__upload_image_for_editing")
        print(f"    image_url: \"{hosted_url}\"")

    # Step 3: Create character reference (if API key and image_id available)
    if api_key and result["image_id"]:
        print("\n[3/3] Creating character reference...")
        char_result = create_character_reference(
            name=name,
            base_prompt=base_prompt,
            description=description,
            image_id=result["image_id"],
            api_key=api_key
        )
        if char_result:
            result["character_id"] = char_result["character_id"]
            result["success"] = True
            print(f"  Character ID: {result['character_id']}")
        else:
            result["error"] = "Failed to create character reference"
    else:
        print("\n[3/3] Use MCP to create character:")
        print("  mcp__go-bananas__create_character")
        print(f"    character_name: \"{name}\"")
        print(f"    base_prompt: \"{base_prompt[:50]}...\"")
        print("    reference_image_ids: [<image_id from step 2>]")
        result["success"] = True  # Hosted URL is enough for MCP workflow

    print(f"\n{'='*60}")
    if result["success"]:
        print(f"SUCCESS: Character '{name}' ready")
    else:
        print("PARTIAL: Image hosted, manual MCP steps needed")
    print(f"{'='*60}")

    return result


def upload_and_create_product(
    image_path: str,
    name: str,
    description: str,
    api_key: str | None = None
) -> dict:
    """
    Full workflow: Host image -> Create product reference.

    Note: Products use hosted URL directly (no image_id needed).

    Args:
        image_path: Local path to product image
        name: Product name
        description: Product description
        api_key: Go Bananas API key (uses env var if not provided)

    Returns:
        {
            "success": bool,
            "hosted_url": str,
            "product_id": int,
            "name": str,
            "error": str (if failed)
        }
    """
    result = {
        "success": False,
        "hosted_url": None,
        "product_id": None,
        "name": name,
        "error": None,
    }

    api_key = api_key or os.environ.get("GO_BANANAS_API_KEY")

    print(f"\n{'='*60}")
    print(f"Creating product: {name}")
    print(f"{'='*60}")

    # Step 1: Host image
    print(f"\n[1/2] Hosting image: {image_path}")
    hosted_url = host_image(image_path)
    if not hosted_url:
        result["error"] = "Failed to host image"
        return result
    result["hosted_url"] = hosted_url

    # Step 2: Create product reference
    if api_key:
        print("\n[2/2] Creating product reference...")
        prod_result = create_product_reference(
            name=name,
            description=description,
            image_url=hosted_url,
            api_key=api_key
        )
        if prod_result:
            result["product_id"] = prod_result["product_id"]
            result["success"] = True
            print(f"  Product ID: {result['product_id']}")
        else:
            result["error"] = "Failed to create product reference"
    else:
        print("\n[2/2] Use MCP to create product:")
        print("  mcp__go-bananas__create_product_reference")
        print(f"    product_name: \"{name}\"")
        print(f"    product_url: \"{hosted_url}\"")
        print(f"    product_description: \"{description[:50]}...\"")
        result["success"] = True  # Hosted URL is enough for MCP workflow

    print(f"\n{'='*60}")
    if result["success"]:
        print(f"SUCCESS: Product '{name}' ready")
    else:
        print("PARTIAL: Image hosted, manual MCP steps needed")
    print(f"{'='*60}")

    return result


def upload_only(image_path: str, api_key: str | None = None) -> dict:
    """
    Upload image only (no character/product creation).

    Returns:
        {
            "success": bool,
            "hosted_url": str,
            "image_id": int (if API key available),
            "error": str (if failed)
        }
    """
    result = {
        "success": False,
        "hosted_url": None,
        "image_id": None,
        "error": None,
    }

    api_key = api_key or os.environ.get("GO_BANANAS_API_KEY")

    print(f"\n{'='*60}")
    print(f"Uploading image: {image_path}")
    print(f"{'='*60}")

    # Host image
    print("\n[1/2] Hosting image...")
    hosted_url = host_image(image_path)
    if not hosted_url:
        result["error"] = "Failed to host image"
        return result
    result["hosted_url"] = hosted_url

    # Upload to Go Bananas if API key available
    if api_key:
        print("\n[2/2] Uploading to Go Bananas...")
        gb_result = upload_to_gobananas_api(hosted_url, api_key)
        if gb_result:
            result["image_id"] = gb_result["image_id"]
            result["success"] = True
            print(f"  Image ID: {result['image_id']}")
        else:
            print("  Note: Use MCP tool instead")
            result["success"] = True
    else:
        print("\n[2/2] Use MCP to upload:")
        print("  mcp__go-bananas__upload_image_for_editing")
        print(f"    image_url: \"{hosted_url}\"")
        result["success"] = True

    print(f"\n{'='*60}")
    print(f"SUCCESS: Image hosted at {hosted_url}")
    print(f"{'='*60}")

    return result


def process_config(config_path: str, api_key: str | None = None) -> list[dict]:
    """
    Process batch upload from JSON config file.

    Config format:
    {
        "characters": [
            {"name": "Sofia", "image": "./model.jpg", "description": "...", "base_prompt": "..."}
        ],
        "products": [
            {"name": "Sandals", "image": "./product.jpg", "description": "..."}
        ]
    }
    """
    with open(config_path) as f:
        config = json.load(f)

    results = []

    # Process characters
    for char in config.get("characters", []):
        result = upload_and_create_character(
            image_path=char["image"],
            name=char["name"],
            base_prompt=char.get("base_prompt", char.get("description", "")),
            description=char.get("description", ""),
            api_key=api_key
        )
        results.append({"type": "character", **result})

    # Process products
    for prod in config.get("products", []):
        result = upload_and_create_product(
            image_path=prod["image"],
            name=prod["name"],
            description=prod.get("description", ""),
            api_key=api_key
        )
        results.append({"type": "product", **result})

    return results


# ============================================================================
# CLI Entry Point
# ============================================================================


def main():
    parser = argparse.ArgumentParser(
        description="Upload images to Go Bananas and create references",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Create character reference
    python upload_to_gobananas.py \\
        --type character \\
        --name "Sofia" \\
        --image "./model.jpg" \\
        --description "Young woman, blonde hair" \\
        --base-prompt "Sofia, young woman with blonde hair, casual beach style"

    # Create product reference
    python upload_to_gobananas.py \\
        --type product \\
        --name "GoldSandals" \\
        --image "./sandals.jpg" \\
        --description "Gold strappy sandals with rhinestones"

    # Upload only (get hosted URL and image_id)
    python upload_to_gobananas.py --upload-only --image "./photo.png"

    # Batch from config
    python upload_to_gobananas.py --config "./assets.json"
        """
    )

    # Mode selection
    parser.add_argument("--type", choices=["character", "product"],
                        help="Type of reference to create")
    parser.add_argument("--upload-only", action="store_true",
                        help="Upload image only, don't create reference")
    parser.add_argument("--config", help="JSON config file for batch processing")

    # Image and metadata
    parser.add_argument("--image", help="Path to image file")
    parser.add_argument("--name", help="Name for the character/product")
    parser.add_argument("--description", help="Description")
    parser.add_argument("--base-prompt", help="Base prompt for character (detailed appearance)")

    # API key
    parser.add_argument("--api-key", help="Go Bananas API key (or set GO_BANANAS_API_KEY)")

    # Output
    parser.add_argument("--output", "-o", help="Output JSON file for results")

    args = parser.parse_args()

    api_key = args.api_key or os.environ.get("GO_BANANAS_API_KEY")

    results = []

    # Batch mode
    if args.config:
        results = process_config(args.config, api_key)

    # Upload only
    elif args.upload_only:
        if not args.image:
            parser.error("--image required with --upload-only")
        result = upload_only(args.image, api_key)
        results.append(result)

    # Create reference
    elif args.type:
        if not args.image or not args.name:
            parser.error("--image and --name required with --type")

        if args.type == "character":
            base_prompt = args.base_prompt or args.description or ""
            result = upload_and_create_character(
                image_path=args.image,
                name=args.name,
                base_prompt=base_prompt,
                description=args.description or "",
                api_key=api_key
            )
        else:  # product
            result = upload_and_create_product(
                image_path=args.image,
                name=args.name,
                description=args.description or "",
                api_key=api_key
            )
        results.append(result)

    else:
        parser.print_help()
        sys.exit(1)

    # Output results
    if args.output:
        with open(args.output, "w") as f:
            json.dump(results, f, indent=2)
        print(f"\nResults saved to: {args.output}")

    # Exit code based on success
    if all(r.get("success") for r in results):
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
