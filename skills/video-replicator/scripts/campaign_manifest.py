#!/usr/bin/env python3
"""
UGC Campaign Manifest Manager.

Manages campaign tracking via a JSON manifest file stored at
``projects/{slug}/campaign_manifest.json``.

Usage:
    # Create a new campaign manifest
    python campaign_manifest.py create --project "my-brand" \
      --product-name "My Product" --product-url "https://example.com" \
      --scripts-count 3 --target-duration 30

    # Update a field
    python campaign_manifest.py update --project "my-brand" \
      --field localization.country --value "UK"

    # Print campaign summary
    python campaign_manifest.py summary --project "my-brand"

    # Generate HTML report
    python campaign_manifest.py report --project "my-brand"

    # Dry-run create (preview without writing)
    python campaign_manifest.py create --project "my-brand" \
      --product-name "My Product" --dry-run
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import PROJECT_BASE, UGC_DEFAULT_SCRIPTS
from exceptions import CampaignManifestError
from logging_config import setup_logging

# Module-level logger
logger = setup_logging(__name__)

MANIFEST_FILENAME = "campaign_manifest.json"


# ============================================================================
# Manifest Schema
# ============================================================================

def _default_manifest(
    product_name: str,
    product_url: str,
    slug: str,
    scripts_count: int = UGC_DEFAULT_SCRIPTS,
    target_duration: int = 30,
) -> dict:
    """Return a new manifest dict with default values."""
    now = datetime.now(timezone.utc).isoformat()
    return {
        "product_name": product_name,
        "product_url": product_url,
        "slug": slug,
        "created_at": now,
        "updated_at": now,
        "scripts_count": scripts_count,
        "target_duration": target_duration,
        "character_reference": {
            "name": None,
            "go_bananas_id": None,
            "character_id": None,
        },
        "product_reference": {
            "name": None,
            "go_bananas_id": None,
        },
        "localization": {
            "country": "US",
            "accent": "american",
            "presenter": {"gender": "any", "age_range": "25-40"},
        },
        "phases_completed": [],
        "strategy_docs": {},
        "scripts": [],
        "videos": [],
        "subtitles": [],
    }


# ============================================================================
# File I/O
# ============================================================================

def _manifest_path(project: str) -> Path:
    """Return the path to the campaign manifest for a project."""
    return Path(PROJECT_BASE) / project / MANIFEST_FILENAME


def _load_manifest(project: str) -> dict:
    """Load an existing manifest from disk."""
    path = _manifest_path(project)
    if not path.exists():
        raise CampaignManifestError(
            f"No campaign manifest found at {path}. "
            f"Run 'create' first."
        )
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CampaignManifestError(
            f"Invalid JSON in {path}: {exc}"
        ) from exc


def _save_manifest(project: str, manifest: dict) -> Path:
    """Write manifest to disk, updating the timestamp."""
    manifest["updated_at"] = datetime.now(timezone.utc).isoformat()
    path = _manifest_path(project)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return path


# ============================================================================
# Core Functions
# ============================================================================

def quick_create_manifest(
    project: str,
    product_name: str,
    audience: str,
    pain: str,
    secret_sauce: str,
    proof: str,
    target_duration: int = 30,
    dry_run: bool = False,
) -> dict:
    """Fast 5-field intake — minimal viable campaign for quick briefs.

    Creates a campaign manifest pre-seeded with strategy essentials
    (avatar pain, offer mechanism, proof point) so you can skip the
    full strategy scaffold and jump straight to script writing.
    """
    path = _manifest_path(project)
    if path.exists():
        raise CampaignManifestError(
            f"Campaign manifest already exists at {path}. "
            f"Delete it first or use 'update' to modify."
        )

    manifest = _default_manifest(
        product_name=product_name,
        product_url="",
        slug=project,
        scripts_count=UGC_DEFAULT_SCRIPTS,
        target_duration=target_duration,
    )

    # Pre-seed strategy fields from the 5-field intake
    manifest["quick_brief"] = {
        "audience": audience,
        "pain": pain,
        "secret_sauce": secret_sauce,
        "proof": proof,
    }

    if dry_run:
        logger.info("[DRY RUN] Would create quick manifest at %s", path)
        logger.info(json.dumps(manifest, indent=2))
        return manifest

    saved = _save_manifest(project, manifest)
    logger.info("Created quick campaign manifest at %s", saved)
    logger.info(
        "Quick brief:\n"
        "  Audience:      %s\n"
        "  Pain:          %s\n"
        "  Secret Sauce:  %s\n"
        "  Proof:         %s",
        audience, pain, secret_sauce, proof,
    )
    return manifest


def create_manifest(
    project: str,
    product_name: str,
    product_url: str = "",
    scripts_count: int = UGC_DEFAULT_SCRIPTS,
    target_duration: int = 30,
    dry_run: bool = False,
) -> dict:
    """Create a new campaign manifest.

    Raises CampaignManifestError if a manifest already exists.
    """
    path = _manifest_path(project)
    if path.exists():
        raise CampaignManifestError(
            f"Campaign manifest already exists at {path}. "
            f"Delete it first or use 'update' to modify."
        )

    manifest = _default_manifest(
        product_name=product_name,
        product_url=product_url,
        slug=project,
        scripts_count=scripts_count,
        target_duration=target_duration,
    )

    if dry_run:
        logger.info("[DRY RUN] Would create manifest at %s", path)
        logger.info(json.dumps(manifest, indent=2))
        return manifest

    saved = _save_manifest(project, manifest)
    logger.info("Created campaign manifest at %s", saved)
    return manifest


def update_manifest(
    project: str,
    field: str,
    value: Any,
    dry_run: bool = False,
) -> dict:
    """Update a single field in the manifest using dot-notation.

    Examples:
        update_manifest("slug", "localization.country", "UK")
        update_manifest("slug", "scripts_count", 5)
        update_manifest("slug", "character_reference.name", "Sofia")
    """
    manifest = _load_manifest(project)

    parts = field.split(".")
    target = manifest
    for part in parts[:-1]:
        if not isinstance(target, dict) or part not in target:
            raise CampaignManifestError(
                f"Invalid field path: '{field}' — "
                f"'{part}' not found in manifest."
            )
        target = target[part]

    final_key = parts[-1]
    if not isinstance(target, dict):
        raise CampaignManifestError(
            f"Cannot set '{final_key}' — parent is not a dict."
        )

    # Attempt to preserve original type
    old_value = target.get(final_key)
    if old_value is not None and isinstance(value, str):
        if isinstance(old_value, int):
            try:
                value = int(value)
            except ValueError:
                pass
        elif isinstance(old_value, float):
            try:
                value = float(value)
            except ValueError:
                pass

    if dry_run:
        logger.info(
            "[DRY RUN] Would set %s: %r -> %r",
            field, target.get(final_key), value,
        )
        return manifest

    target[final_key] = value
    _save_manifest(project, manifest)
    logger.info("Updated %s: %r", field, value)
    return manifest


def get_manifest_summary(project: str) -> str:
    """Return a human-readable summary of the campaign."""
    manifest = _load_manifest(project)

    lines = [
        f"Campaign: {manifest['product_name']}",
        f"  URL:              {manifest.get('product_url') or '(none)'}",
        f"  Slug:             {manifest['slug']}",
        f"  Scripts:          {manifest['scripts_count']}",
        f"  Target duration:  {manifest['target_duration']}s",
        f"  Created:          {manifest['created_at']}",
        f"  Updated:          {manifest['updated_at']}",
    ]

    # Character reference
    char = manifest.get("character_reference", {})
    if char.get("name"):
        lines.append(f"  Character:        {char['name']} "
                      f"(GB: {char.get('go_bananas_id')}, "
                      f"ID: {char.get('character_id')})")

    # Product reference
    prod = manifest.get("product_reference", {})
    if prod.get("name"):
        lines.append(f"  Product ref:      {prod['name']} "
                      f"(GB: {prod.get('go_bananas_id')})")

    # Localization
    loc = manifest.get("localization", {})
    presenter = loc.get("presenter", {})
    lines.append(
        f"  Locale:           {loc.get('country', '?')} / "
        f"{loc.get('accent', '?')} / "
        f"{presenter.get('gender', '?')} {presenter.get('age_range', '?')}"
    )

    # Phases
    phases = manifest.get("phases_completed", [])
    lines.append(f"  Phases done:      {', '.join(phases) if phases else '(none)'}")

    # Scripts
    scripts = manifest.get("scripts", [])
    if scripts:
        lines.append(f"  Scripts ({len(scripts)}):")
        for i, s in enumerate(scripts, 1):
            status = s.get("status", "unknown")
            duration = s.get("duration", "?")
            scenes = len(s.get("scenes", []))
            lines.append(f"    [{i}] {status} — {duration}s, {scenes} scenes")

    # Videos
    videos = manifest.get("videos", [])
    if videos:
        lines.append(f"  Videos:           {len(videos)}")

    return "\n".join(lines)


def generate_report(project: str, dry_run: bool = False) -> Path:
    """Generate an HTML campaign report.

    Output: projects/{slug}/final/campaign_report.html
    """
    manifest = _load_manifest(project)

    project_dir = Path(PROJECT_BASE) / project
    final_dir = project_dir / "final"

    output_path = final_dir / "campaign_report.html"

    if dry_run:
        logger.info("[DRY RUN] Would generate report at %s", output_path)
        return output_path

    final_dir.mkdir(parents=True, exist_ok=True)

    html = _build_report_html(manifest)
    output_path.write_text(html, encoding="utf-8")
    logger.info("Generated campaign report at %s", output_path)
    return output_path


# ============================================================================
# HTML Report Builder
# ============================================================================

def _build_report_html(manifest: dict) -> str:
    """Build the HTML string for the campaign report."""
    product_name = _html_escape(manifest.get("product_name", ""))
    product_url = _html_escape(manifest.get("product_url", ""))
    slug = _html_escape(manifest.get("slug", ""))
    scripts_count = manifest.get("scripts_count", 0)
    target_duration = manifest.get("target_duration", 0)
    created_at = _html_escape(manifest.get("created_at", ""))
    updated_at = _html_escape(manifest.get("updated_at", ""))
    phases = manifest.get("phases_completed", [])
    scripts = manifest.get("scripts", [])
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    # Phase rows
    phase_rows = ""
    if phases:
        for phase in phases:
            phase_rows += f"<li>{_html_escape(str(phase))}</li>\n"
    else:
        phase_rows = "<li>(none)</li>\n"

    # Script rows
    script_rows = ""
    if scripts:
        for i, s in enumerate(scripts, 1):
            status = _html_escape(str(s.get("status", "unknown")))
            duration = s.get("duration", "?")
            scenes = len(s.get("scenes", []))
            script_rows += (
                f"<tr>"
                f"<td>{i}</td>"
                f"<td>{status}</td>"
                f"<td>{duration}s</td>"
                f"<td>{scenes}</td>"
                f"</tr>\n"
            )
    else:
        script_rows = (
            '<tr><td colspan="4">No scripts yet</td></tr>\n'
        )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Campaign Report — {product_name}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; }}
  h1 {{ border-bottom: 2px solid #333; padding-bottom: 8px; }}
  h2 {{ color: #555; margin-top: 32px; }}
  table {{ border-collapse: collapse; width: 100%; margin-top: 12px; }}
  th, td {{ border: 1px solid #ddd; padding: 8px 12px; text-align: left; }}
  th {{ background: #f5f5f5; }}
  .meta {{ color: #888; font-size: 0.9em; }}
  .overview {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }}
  .overview dt {{ font-weight: 600; }}
  .overview dd {{ margin: 0; }}
  ul {{ padding-left: 20px; }}
</style>
</head>
<body>
<h1>Campaign Report</h1>
<p class="meta">Generated: {generated_at}</p>

<h2>Overview</h2>
<dl class="overview">
  <dt>Product</dt><dd>{product_name}</dd>
  <dt>URL</dt><dd>{product_url or '(none)'}</dd>
  <dt>Slug</dt><dd>{slug}</dd>
  <dt>Scripts</dt><dd>{scripts_count}</dd>
  <dt>Target Duration</dt><dd>{target_duration}s</dd>
  <dt>Created</dt><dd>{created_at}</dd>
  <dt>Updated</dt><dd>{updated_at}</dd>
</dl>

<h2>Phases Completed</h2>
<ul>
{phase_rows}</ul>

<h2>Scripts</h2>
<table>
  <thead>
    <tr><th>#</th><th>Status</th><th>Duration</th><th>Scenes</th></tr>
  </thead>
  <tbody>
{script_rows}  </tbody>
</table>

</body>
</html>
"""


def _html_escape(text: str) -> str:
    """Minimal HTML escaping for report output."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


# ============================================================================
# CLI
# ============================================================================

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="UGC Campaign Manifest Manager",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # --- quick-create ---
    quick_p = sub.add_parser(
        "quick-create",
        help="Fast 5-field intake — skip full strategy scaffold",
    )
    quick_p.add_argument("--project", required=True, help="Project slug")
    quick_p.add_argument("--product-name", required=True, help="Product name")
    quick_p.add_argument("--audience", required=True, help="Target audience (e.g., 'Busy moms with no time')")
    quick_p.add_argument("--pain", required=True, help="Main problem/struggle (e.g., 'Skin looks tired/dull')")
    quick_p.add_argument("--secret-sauce", required=True, help="Why it works — the mechanism (e.g., 'Contains Snail Mucin')")
    quick_p.add_argument("--proof", required=True, help="Proof/outcome (e.g., 'Glass skin in 7 days')")
    quick_p.add_argument(
        "--target-duration", type=int, default=30,
        help="Target video duration in seconds (default: 30)",
    )
    quick_p.add_argument("--dry-run", action="store_true", help="Preview without writing")
    quick_p.add_argument("--yes", "-y", action="store_true", help="Skip confirmation")

    # --- create ---
    create_p = sub.add_parser("create", help="Create a new campaign manifest")
    create_p.add_argument("--project", required=True, help="Project slug")
    create_p.add_argument("--product-name", required=True, help="Product name")
    create_p.add_argument("--product-url", default="", help="Product URL")
    create_p.add_argument(
        "--scripts-count", type=int, default=UGC_DEFAULT_SCRIPTS,
        help=f"Number of belief scripts (default: {UGC_DEFAULT_SCRIPTS})",
    )
    create_p.add_argument(
        "--target-duration", type=int, default=30,
        help="Target video duration in seconds (default: 30)",
    )
    create_p.add_argument("--dry-run", action="store_true", help="Preview without writing")
    create_p.add_argument("--yes", "-y", action="store_true", help="Skip confirmation")

    # --- update ---
    update_p = sub.add_parser("update", help="Update a manifest field")
    update_p.add_argument("--project", required=True, help="Project slug")
    update_p.add_argument("--field", required=True, help="Dot-notation field path")
    update_p.add_argument("--value", required=True, help="New value")
    update_p.add_argument("--dry-run", action="store_true", help="Preview without writing")
    update_p.add_argument("--yes", "-y", action="store_true", help="Skip confirmation")

    # --- summary ---
    summary_p = sub.add_parser("summary", help="Print campaign summary")
    summary_p.add_argument("--project", required=True, help="Project slug")

    # --- report ---
    report_p = sub.add_parser("report", help="Generate HTML campaign report")
    report_p.add_argument("--project", required=True, help="Project slug")
    report_p.add_argument("--dry-run", action="store_true", help="Preview without writing")
    report_p.add_argument("--yes", "-y", action="store_true", help="Skip confirmation")

    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    try:
        if args.command == "quick-create":
            quick_create_manifest(
                project=args.project,
                product_name=args.product_name,
                audience=args.audience,
                pain=args.pain,
                secret_sauce=args.secret_sauce,
                proof=args.proof,
                target_duration=args.target_duration,
                dry_run=args.dry_run,
            )

        elif args.command == "create":
            create_manifest(
                project=args.project,
                product_name=args.product_name,
                product_url=args.product_url,
                scripts_count=args.scripts_count,
                target_duration=args.target_duration,
                dry_run=args.dry_run,
            )

        elif args.command == "update":
            update_manifest(
                project=args.project,
                field=args.field,
                value=args.value,
                dry_run=args.dry_run,
            )

        elif args.command == "summary":
            summary = get_manifest_summary(args.project)
            print(summary)

        elif args.command == "report":
            generate_report(
                project=args.project,
                dry_run=args.dry_run,
            )

    except CampaignManifestError as exc:
        logger.error(str(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
