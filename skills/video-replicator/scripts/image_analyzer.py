#!/usr/bin/env python3
"""
Image Quality Analyzer using Gemini Vision API.

Analyzes generated images for quality issues before video generation.
Uses structured scoring across multiple quality dimensions.

Usage:
    from image_analyzer import ImageAnalyzer, analyze_image_quality

    # Single image analysis
    result = analyze_image_quality(
        image_path="scene_1_frame.jpg",
        prompt="Woman walking on beach in golden hour",
        target_ratio="portrait"
    )

    # Batch analysis
    analyzer = ImageAnalyzer()
    results = analyzer.analyze_batch(image_paths, prompts, "portrait")

Requirements:
    pip install google-genai Pillow

Environment:
    GOOGLE_API_KEY - Required for Gemini API access
"""

import base64
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("Error: google-genai not installed. Run: pip install google-genai")
    sys.exit(1)

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from exceptions import ValidationError
from utils_image import get_aspect_ratio_type, get_image_dimensions

# ============================================================================
# Quality Scoring Configuration
# ============================================================================

# Weights for each quality dimension (must sum to 1.0)
# Focused on what matters for video generation:
# - Anatomy issues (extra fingers, distorted limbs) are dealbreakers
# - Aspect ratio must match for video pipeline
# - Prompt adherence is often irrelevant (prompts may differ from stored)
QUALITY_WEIGHTS = {
    "anatomy": 0.50,       # Limbs, hands, face, proportions - DEALBREAKER
    "composition": 0.20,   # Framing, subject placement
    "prompt_adherence": 0.10,  # Required elements present - often N/A
    "aspect_ratio": 0.20,  # Matches target ratio - critical for video
}

# Score thresholds for actions (realistic for AI-generated images)
THRESHOLD_AUTO_APPROVE = 0.75   # >= 75% auto-approve
THRESHOLD_MANUAL_REVIEW = 0.50  # 50-74% flag for manual
# < 50% auto-regenerate

# System prompt for quality analysis
QUALITY_ANALYSIS_PROMPT = """You are an expert image quality analyst for AI-generated images.
You must be VERY STRICT about anatomy issues - these are dealbreakers for video generation.

Analyze the provided image and score it across these dimensions:

## 1. ANATOMY (0.0-1.0) - BE VERY STRICT
Check for anatomical correctness in human/animal subjects:

**HANDS (check carefully):**
- Count fingers on each visible hand - must be exactly 5
- Check for merged, extra, or missing fingers
- Verify natural hand poses and proportions

**LEGS (check carefully - common AI failure point):**
- COMPARE both legs side-by-side: they must have SIMILAR thickness
- If one leg is noticeably thinner/thicker than the other, this is a SEVERE issue
- Check for unnaturally thin, elongated, or bent legs
- Verify natural walking/standing poses
- Look for impossible angles at knees/ankles
- Check that legs connect naturally to torso/hips
- In walking poses: back leg should NOT be dramatically thinner than front leg

**ARMS:**
- Natural length and proportions
- Elbows bend correctly
- No extra or missing arms

**FACE:**
- Natural features, symmetric eyes
- Correct ear/nose/mouth placement
- No distortions or mutations

**BODY PROPORTIONS:**
- Natural head-to-body ratio
- Torso length appropriate
- Limbs proportional to body

If no humans/animals in image, score based on object proportions.

Issues to penalize (BE STRICT):
- Extra or missing fingers (severe: -0.5)
- Legs with DIFFERENT thickness from each other (severe: -0.4)
- Distorted/unnatural legs (severe: -0.4)
- Unnaturally thin or elongated limbs (severe: -0.4)
- Impossible joint angles (severe: -0.3)
- Distorted arms or body parts (moderate: -0.3)
- Unnatural face features (moderate: -0.2)
- Minor proportion issues (minor: -0.1)

IMPORTANT: If legs have noticeably different thickness, score anatomy 0.6 or lower.

## 2. COMPOSITION (0.0-1.0)
Check visual composition quality:
- Subject placement (rule of thirds, centering)
- Framing (appropriate headroom, look space)
- Visual balance (not too cluttered/empty)
- Focus (subject clearly visible)

Issues to penalize:
- Subject cut off at edges (-0.3)
- Poor framing (-0.2)
- Cluttered or unbalanced (-0.1)

## 3. PROMPT_ADHERENCE (0.0-1.0) - STRICT ON SUBJECT COUNT
Check if image matches the provided prompt:

**SUBJECT COUNT (CRITICAL - check first):**
- If prompt says "one person/woman/man" → image MUST have exactly 1 person
- If prompt says "two people/women/men" → image MUST have exactly 2 people
- If prompt says "three people" → image MUST have exactly 3 people
- WRONG SUBJECT COUNT IS A DEALBREAKER - score 0.2 or lower

**Other checks:**
- Main subject present as described
- Action/pose matches description
- Setting/environment matches
- Key elements included

Issues to penalize:
- WRONG NUMBER OF SUBJECTS (severe: -0.8) - e.g., 3 people when prompt said "two"
- Missing main subject (-0.5)
- Wrong action/pose (-0.3)
- Wrong setting (-0.2)
- Missing key elements (-0.1 each)

IMPORTANT: If the image has the wrong number of people/subjects, score prompt_adherence 0.2 or lower regardless of other factors.

## 4. ASPECT_RATIO (0.0-1.0)
Check if image matches target aspect ratio:
- Portrait (9:16): Score 1.0 if portrait, 0.3 if landscape
- Landscape (16:9): Score 1.0 if landscape, 0.3 if portrait
- Square (1:1): Score 1.0 if square, 0.5 otherwise

## OUTPUT FORMAT
Return ONLY valid JSON (no markdown):
{
    "scores": {
        "anatomy": 0.0-1.0,
        "composition": 0.0-1.0,
        "prompt_adherence": 0.0-1.0,
        "aspect_ratio": 0.0-1.0
    },
    "weighted_score": 0.0-1.0,
    "issues": [
        {"category": "anatomy|composition|prompt_adherence|aspect_ratio",
         "severity": "minor|moderate|severe",
         "description": "Brief description of issue"}
    ],
    "recommendation": "approve|review|regenerate",
    "summary": "One sentence summary of image quality"
}

Be strict but fair. Commercial-quality images should score 0.8+.
"""


@dataclass
class QualityScore:
    """Quality analysis result for a single image."""
    anatomy: float
    composition: float
    prompt_adherence: float
    aspect_ratio: float
    weighted_score: float
    issues: list[dict]
    recommendation: str
    summary: str
    image_path: str
    scene_number: int | None = None

    @classmethod
    def from_dict(cls, data: dict, image_path: str, scene_number: int | None = None) -> "QualityScore":
        """Create from API response dictionary."""
        scores = data.get("scores", {})
        return cls(
            anatomy=scores.get("anatomy", 0.0),
            composition=scores.get("composition", 0.0),
            prompt_adherence=scores.get("prompt_adherence", 0.0),
            aspect_ratio=scores.get("aspect_ratio", 0.0),
            weighted_score=data.get("weighted_score", 0.0),
            issues=data.get("issues", []),
            recommendation=data.get("recommendation", "regenerate"),
            summary=data.get("summary", "Analysis failed"),
            image_path=image_path,
            scene_number=scene_number
        )

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            "scores": {
                "anatomy": self.anatomy,
                "composition": self.composition,
                "prompt_adherence": self.prompt_adherence,
                "aspect_ratio": self.aspect_ratio
            },
            "weighted_score": self.weighted_score,
            "issues": self.issues,
            "recommendation": self.recommendation,
            "summary": self.summary,
            "image_path": self.image_path,
            "scene_number": self.scene_number
        }

    @property
    def should_regenerate(self) -> bool:
        """Check if image should be regenerated."""
        # Recommendation takes precedence (e.g., leg anatomy override)
        if self.recommendation == "regenerate":
            return True
        return self.weighted_score < THRESHOLD_MANUAL_REVIEW

    @property
    def needs_review(self) -> bool:
        """Check if image needs manual review."""
        # Recommendation takes precedence
        if self.recommendation == "review":
            return True
        if self.recommendation == "regenerate":
            return False  # Regenerate, not review
        return THRESHOLD_MANUAL_REVIEW <= self.weighted_score < THRESHOLD_AUTO_APPROVE

    @property
    def approved(self) -> bool:
        """Check if image is auto-approved."""
        # Recommendation takes precedence - if regenerate/review, NOT approved
        if self.recommendation in ("regenerate", "review"):
            return False
        return self.recommendation == "approve" or self.weighted_score >= THRESHOLD_AUTO_APPROVE


class ImageAnalyzer:
    """
    Gemini Vision API wrapper for image quality analysis.

    Uses structured prompting to analyze generated images across
    multiple quality dimensions and return actionable recommendations.
    """

    def __init__(self, api_key: str | None = None, model_name: str = "gemini-3-flash-preview"):
        """
        Initialize the analyzer.

        Args:
            api_key: Gemini API key (defaults to GOOGLE_API_KEY env var)
            model_name: Gemini model to use (default: gemini-3-flash-preview)
        """
        self.api_key = api_key or os.environ.get("GOOGLE_API_KEY")
        if not self.api_key:
            raise ValidationError("GOOGLE_API_KEY environment variable not set")

        self.model_name = model_name
        self.client = genai.Client(api_key=self.api_key)

    def _load_image_as_base64(self, image_path: str) -> str:
        """Load image file and convert to base64."""
        with open(image_path, "rb") as f:
            return base64.standard_b64encode(f.read()).decode("utf-8")

    def _get_mime_type(self, image_path: str) -> str:
        """Get MIME type from file extension."""
        ext = Path(image_path).suffix.lower()
        mime_types = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".gif": "image/gif",
        }
        return mime_types.get(ext, "image/jpeg")

    def _calculate_weighted_score(self, scores: dict) -> float:
        """Calculate weighted score from individual dimension scores."""
        weighted = sum(
            scores.get(dim, 0.0) * weight
            for dim, weight in QUALITY_WEIGHTS.items()
        )
        return round(weighted, 3)

    def _determine_recommendation(self, weighted_score: float) -> str:
        """Determine recommendation based on weighted score."""
        if weighted_score >= THRESHOLD_AUTO_APPROVE:
            return "approve"
        elif weighted_score >= THRESHOLD_MANUAL_REVIEW:
            return "review"
        return "regenerate"

    def _get_aspect_ratio_score(self, image_path: str, target_ratio: str) -> float:
        """
        Calculate aspect ratio score based on image dimensions.

        Args:
            image_path: Path to the image file
            target_ratio: Target ratio ("portrait", "landscape", "square", "9:16", "16:9", "1:1")

        Returns:
            Score from 0.0 to 1.0
        """
        dims = get_image_dimensions(image_path)
        if not dims:
            return 0.5  # Unknown dimensions

        w, h = dims
        img_ratio_type = get_aspect_ratio_type(w, h)

        # Normalize target ratio
        target_type = target_ratio.lower()
        if target_type in ("portrait", "9:16", "2:3", "3:4"):
            target_type = "portrait"
        elif target_type in ("landscape", "16:9", "3:2", "4:3"):
            target_type = "landscape"
        elif target_type in ("square", "1:1"):
            target_type = "square"

        # Calculate score
        if img_ratio_type == target_type:
            return 1.0
        elif target_type == "square":
            return 0.5  # Square is somewhat flexible
        else:
            return 0.3  # Wrong orientation

    def _check_leg_anatomy(self, image_path: str) -> tuple[float, list[dict]]:
        """
        Pre-check specifically for leg anatomy issues (common AI failure).

        Returns:
            Tuple of (leg_score, issues_list)
        """
        image_data = self._load_image_as_base64(image_path)
        mime_type = self._get_mime_type(image_path)

        leg_prompt = """This is an AI-generated image. AI often makes mistakes with legs.

Look VERY critically at the legs and answer honestly:
1. Compare the thickness of both legs - are they EXACTLY the same width, or is one thinner?
2. Do the leg proportions look 100% natural, or is there anything slightly off?
3. Any issues with how the legs connect to the body or bend at the joints?

Be a harsh critic - find ANY imperfection. Even small differences matter.

Return JSON with your honest assessment:
{"thickness_identical": true/false, "any_leg_thinner": true/false, "proportions_perfect": true/false, "detected_issues": ["list any issues, even minor ones"]}"""

        try:
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=[
                    types.Part.from_bytes(
                        data=base64.standard_b64decode(image_data),
                        mime_type=mime_type
                    ),
                    leg_prompt
                ],
                config=types.GenerateContentConfig(temperature=0.1, max_output_tokens=512)
            )

            response_text = response.text.strip()
            if response_text.startswith("```"):
                lines = response_text.split("\n")
                response_text = "\n".join(lines[1:-1])

            result = json.loads(response_text)

            issues = []
            score = 1.0

            # Penalize if legs don't match thickness
            if not result.get("thickness_identical", True) or result.get("any_leg_thinner", False):
                score = 0.5  # Severe penalty
                issues.append({
                    "category": "anatomy",
                    "severity": "severe",
                    "description": "Legs have different thickness - one leg is thinner than the other"
                })

            if not result.get("proportions_perfect", True):
                score = min(score, 0.6)
                issues.append({
                    "category": "anatomy",
                    "severity": "moderate",
                    "description": "Leg proportions are not perfect"
                })

            for issue in result.get("detected_issues", []):
                if issue and issue.strip():
                    score = min(score, 0.7)  # Any detected issue lowers score
                    issues.append({
                        "category": "anatomy",
                        "severity": "moderate",
                        "description": issue
                    })

            return score, issues

        except Exception:
            # If leg check fails, don't block - return neutral
            return 0.8, []

    def _extract_expected_subject_count(self, prompt: str) -> int | None:
        """
        Extract expected number of subjects from prompt.

        Returns:
            Expected count (1, 2, 3, etc.) or None if not specified
        """
        import re

        prompt_lower = prompt.lower()

        # Number word patterns
        number_words = {
            "one": 1, "single": 1, "a person": 1, "a woman": 1, "a man": 1,
            "two": 2, "pair": 2, "couple": 2, "both": 2,
            "three": 3, "trio": 3,
            "four": 4, "group of four": 4,
            "five": 5, "group of five": 5,
        }

        for word, count in number_words.items():
            if word in prompt_lower:
                return count

        # Digit patterns: "2 women", "3 people"
        match = re.search(r'\b(\d+)\s*(people|persons|women|men|models|characters|subjects)', prompt_lower)
        if match:
            return int(match.group(1))

        return None

    def _check_subject_count(self, image_path: str, prompt: str) -> tuple[float, list[dict]]:
        """
        Pre-check for correct number of subjects (critical for character scenes).

        Returns:
            Tuple of (subject_count_score, issues_list)
        """
        expected_count = self._extract_expected_subject_count(prompt)
        if expected_count is None:
            # No specific count in prompt - skip this check
            return 1.0, []

        image_data = self._load_image_as_base64(image_path)
        mime_type = self._get_mime_type(image_path)

        count_prompt = """Count the number of DISTINCT people/human subjects in this image.

Be very careful - count each person only once, even if:
- They appear to be duplicated/repeated
- They're in different poses
- Parts of them are visible

Rules:
- Only count people (not reflections, shadows, or images within images)
- Count partial people if they're clearly distinct individuals

Return JSON only:
{"actual_count": N, "description": "brief description of who you see"}"""

        try:
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=[
                    types.Part.from_bytes(
                        data=base64.standard_b64decode(image_data),
                        mime_type=mime_type
                    ),
                    count_prompt
                ],
                config=types.GenerateContentConfig(temperature=0.1, max_output_tokens=256)
            )

            response_text = response.text.strip()
            if response_text.startswith("```"):
                lines = response_text.split("\n")
                response_text = "\n".join(lines[1:-1])

            result = json.loads(response_text)
            actual_count = result.get("actual_count", 0)
            description = result.get("description", "")

            if actual_count == expected_count:
                return 1.0, []

            # Wrong count - severe issue
            issues = [{
                "category": "subject_count",
                "severity": "severe",
                "description": f"WRONG NUMBER OF SUBJECTS: Expected {expected_count}, found {actual_count}. {description}"
            }]

            # Score 0.2 for wrong count (dealbreaker)
            return 0.2, issues

        except Exception:
            # If count check fails, don't block - return neutral
            return 0.8, []

    def analyze_image(
        self,
        image_path: str,
        prompt: str,
        target_ratio: str = "portrait",
        scene_number: int | None = None
    ) -> QualityScore:
        """
        Analyze a single image for quality issues.

        Args:
            image_path: Path to the image file
            prompt: The original prompt used to generate the image
            target_ratio: Target aspect ratio ("portrait", "landscape", "square")
            scene_number: Optional scene number for tracking

        Returns:
            QualityScore with detailed analysis results
        """
        if not os.path.exists(image_path):
            return QualityScore(
                anatomy=0.0, composition=0.0, prompt_adherence=0.0, aspect_ratio=0.0,
                weighted_score=0.0, issues=[{"category": "file", "severity": "severe",
                                             "description": f"File not found: {image_path}"}],
                recommendation="regenerate", summary="Image file not found",
                image_path=image_path, scene_number=scene_number
            )

        # Pre-calculate aspect ratio score from actual dimensions
        aspect_score = self._get_aspect_ratio_score(image_path, target_ratio)

        # Pre-check leg anatomy specifically (common AI failure point)
        leg_score, leg_issues = self._check_leg_anatomy(image_path)

        # Pre-check subject count (critical for character scenes)
        subject_score, subject_issues = self._check_subject_count(image_path, prompt)

        # Prepare image for API
        image_data = self._load_image_as_base64(image_path)
        mime_type = self._get_mime_type(image_path)

        # Build analysis prompt
        user_prompt = f"""Analyze this image for quality issues.

ORIGINAL PROMPT: {prompt}

TARGET ASPECT RATIO: {target_ratio}

Note: For aspect_ratio score, the image is {'correctly' if aspect_score >= 0.8 else 'incorrectly'} oriented.
Pre-calculated aspect score: {aspect_score}

Analyze the other dimensions (anatomy, composition, prompt_adherence) carefully.
Return JSON only, no markdown code blocks."""

        try:
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=[
                    types.Part.from_bytes(
                        data=base64.standard_b64decode(image_data),
                        mime_type=mime_type
                    ),
                    user_prompt
                ],
                config=types.GenerateContentConfig(
                    system_instruction=QUALITY_ANALYSIS_PROMPT,
                    temperature=0.1,  # Low temperature for consistent analysis
                    max_output_tokens=2048,
                )
            )

            # Parse response
            response_text = response.text.strip()

            # Remove markdown code blocks if present
            if response_text.startswith("```"):
                lines = response_text.split("\n")
                response_text = "\n".join(lines[1:-1])

            result = json.loads(response_text)

            # Override aspect_ratio with pre-calculated score
            if "scores" in result:
                result["scores"]["aspect_ratio"] = aspect_score

                # Apply leg anatomy check - use minimum of general anatomy and leg-specific score
                if leg_score < 1.0:
                    result["scores"]["anatomy"] = min(result["scores"].get("anatomy", 1.0), leg_score)
                    # Add leg issues to the issues list
                    if "issues" not in result:
                        result["issues"] = []
                    result["issues"].extend(leg_issues)

                # Apply subject count check - use minimum with prompt_adherence
                if subject_score < 1.0:
                    result["scores"]["prompt_adherence"] = min(
                        result["scores"].get("prompt_adherence", 1.0), subject_score
                    )
                    if "issues" not in result:
                        result["issues"] = []
                    result["issues"].extend(subject_issues)

                # Recalculate weighted score
                result["weighted_score"] = self._calculate_weighted_score(result["scores"])
                result["recommendation"] = self._determine_recommendation(result["weighted_score"])

                # OVERRIDE: If subject count is wrong, force regenerate (dealbreaker)
                if subject_score <= 0.5:
                    result["recommendation"] = "regenerate"
                    result["summary"] = "WRONG SUBJECT COUNT - " + result.get("summary", "")

                # OVERRIDE: If leg anatomy is severely compromised, force review/regenerate
                # Leg issues are dealbreakers for video generation
                if leg_score <= 0.5:
                    result["recommendation"] = "regenerate"
                    result["summary"] = "Leg anatomy issues detected - " + result.get("summary", "")
                elif leg_score < 0.7:
                    if result["recommendation"] == "approve":
                        result["recommendation"] = "review"

            return QualityScore.from_dict(result, image_path, scene_number)

        except json.JSONDecodeError as e:
            return QualityScore(
                anatomy=0.5, composition=0.5, prompt_adherence=0.5, aspect_ratio=aspect_score,
                weighted_score=0.5, issues=[{"category": "analysis", "severity": "moderate",
                                             "description": f"Failed to parse analysis: {e}"}],
                recommendation="review", summary="Analysis parsing failed",
                image_path=image_path, scene_number=scene_number
            )
        except Exception as e:
            return QualityScore(
                anatomy=0.0, composition=0.0, prompt_adherence=0.0, aspect_ratio=0.0,
                weighted_score=0.0, issues=[{"category": "analysis", "severity": "severe",
                                             "description": f"Analysis failed: {e}"}],
                recommendation="regenerate", summary=f"Analysis error: {str(e)[:50]}",
                image_path=image_path, scene_number=scene_number
            )

    def analyze_batch(
        self,
        image_paths: list[str],
        prompts: dict[int, str],
        target_ratio: str = "portrait"
    ) -> dict[int, QualityScore]:
        """
        Analyze multiple images.

        Args:
            image_paths: List of image file paths
            prompts: Dict mapping scene number to prompt
            target_ratio: Target aspect ratio

        Returns:
            Dict mapping scene number to QualityScore
        """
        import re

        results = {}

        for image_path in image_paths:
            # Extract scene number from filename
            match = re.search(r"scene_(\d+)", Path(image_path).name)
            if not match:
                continue

            scene_num = int(match.group(1))
            prompt = prompts.get(scene_num, "")

            print(f"  Analyzing scene {scene_num}...")
            result = self.analyze_image(image_path, prompt, target_ratio, scene_num)
            results[scene_num] = result

            # Print summary
            status = "PASS" if result.approved else "REVIEW" if result.needs_review else "FAIL"
            print(f"    Score: {result.weighted_score:.2f} ({status})")

        return results


# ============================================================================
# Convenience Functions
# ============================================================================


def analyze_image_quality(
    image_path: str,
    prompt: str,
    target_ratio: str = "portrait",
    api_key: str | None = None
) -> QualityScore:
    """
    Analyze a single image for quality issues.

    Convenience function that creates an analyzer and runs analysis.

    Args:
        image_path: Path to the image file
        prompt: The original prompt used to generate the image
        target_ratio: Target aspect ratio
        api_key: Gemini API key (defaults to GOOGLE_API_KEY env var)

    Returns:
        QualityScore with detailed analysis results
    """
    analyzer = ImageAnalyzer(api_key=api_key)
    return analyzer.analyze_image(image_path, prompt, target_ratio)


def print_quality_report(results: dict[int, QualityScore]) -> None:
    """
    Print a formatted quality report.

    Args:
        results: Dict mapping scene number to QualityScore
    """
    print(f"\n{'='*70}")
    print("IMAGE QUALITY REPORT")
    print(f"{'='*70}")

    approved = []
    review = []
    regenerate = []

    for scene_num in sorted(results.keys()):
        score = results[scene_num]

        if score.approved:
            approved.append(scene_num)
            status = "PASS"
        elif score.needs_review:
            review.append(scene_num)
            status = "REVIEW"
        else:
            regenerate.append(scene_num)
            status = "FAIL"

        print(f"\nScene {scene_num}: {status} ({score.weighted_score:.2f})")
        print(f"  Anatomy:    {score.anatomy:.2f}  Composition: {score.composition:.2f}")
        print(f"  Adherence:  {score.prompt_adherence:.2f}  Aspect:      {score.aspect_ratio:.2f}")
        print(f"  Summary: {score.summary}")

        if score.issues:
            for issue in score.issues[:3]:  # Show top 3 issues
                severity = issue.get("severity", "")
                desc = issue.get("description", "")
                print(f"  - [{severity.upper()}] {desc}")

    print(f"\n{'='*70}")
    print("SUMMARY")
    print(f"{'='*70}")
    print(f"  Approved:    {len(approved)} scenes {approved if approved else ''}")
    print(f"  Need Review: {len(review)} scenes {review if review else ''}")
    print(f"  Regenerate:  {len(regenerate)} scenes {regenerate if regenerate else ''}")
    print(f"{'='*70}\n")


# ============================================================================
# CLI Entry Point
# ============================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Analyze image quality using Gemini Vision")
    parser.add_argument("--image", "-i", required=True, help="Path to image file")
    parser.add_argument("--prompt", "-p", required=True, help="Original generation prompt")
    parser.add_argument("--ratio", "-r", default="portrait",
                        choices=["portrait", "landscape", "square"],
                        help="Target aspect ratio (default: portrait)")
    parser.add_argument("--output", "-o", help="Save results to JSON file")

    args = parser.parse_args()

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("Error: GOOGLE_API_KEY environment variable not set")
        sys.exit(1)

    print(f"Analyzing: {args.image}")
    result = analyze_image_quality(args.image, args.prompt, args.ratio, api_key)

    # Print results
    status = "PASS" if result.approved else "REVIEW" if result.needs_review else "FAIL"
    print(f"\nResult: {status} (score: {result.weighted_score:.2f})")
    print(f"Summary: {result.summary}")

    if result.issues:
        print("\nIssues found:")
        for issue in result.issues:
            print(f"  - [{issue.get('severity', '').upper()}] {issue.get('description', '')}")

    if args.output:
        with open(args.output, "w") as f:
            json.dump(result.to_dict(), f, indent=2)
        print(f"\nResults saved to: {args.output}")

    sys.exit(0 if result.approved else 1)
