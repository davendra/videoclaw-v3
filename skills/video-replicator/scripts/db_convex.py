#!/usr/bin/env python3
"""
Convex Database Adapter for Video Replicator
Provides the same interface as db.py but stores data in Convex cloud.

Requires:
    pip install convex

Setup:
    export CONVEX_URL=https://your-project.convex.cloud

Usage:
    from db_convex import VideoReplicatorConvexDB
    db = VideoReplicatorConvexDB()
    db.create_project("prada-snow", "Prada Snow Campaign")
"""

import json
import os
import time
from datetime import datetime

# Lazy-load convex to avoid import errors when not used
_convex_client = None


def _get_convex_client():
    """Get or create Convex client (lazy loading)."""
    global _convex_client
    if _convex_client is None:
        try:
            from convex import ConvexClient
        except ImportError as err:
            raise ImportError(
                "Convex Python client not installed. Run: pip install convex"
            ) from err

        convex_url = os.environ.get("CONVEX_URL")
        if not convex_url:
            raise OSError(
                "CONVEX_URL environment variable not set. "
                "Set it to your Convex deployment URL."
            )

        _convex_client = ConvexClient(convex_url)

    return _convex_client


def _now_ms() -> int:
    """Get current timestamp in milliseconds."""
    return int(time.time() * 1000)


class VideoReplicatorConvexDB:
    """Convex database adapter matching VideoReplicatorDB interface."""

    def __init__(self):
        """Initialize Convex client connection."""
        self._client = _get_convex_client()
        self._user_id = None
        self._ensure_user()

    def _ensure_user(self):
        """Ensure current user exists in Convex (for ownership tracking)."""
        email = os.environ.get("CONVEX_USER_EMAIL", "local@localhost")

        # Try to find existing user
        result = self._client.query("queries/users:getByEmail", {"email": email})
        if result:
            self._user_id = result["_id"]
        else:
            # Create user
            self._user_id = self._client.mutation("mutations/videoReplicator:createUser", {
                "externalId": f"local_{email}",
                "email": email,
                "createdAt": _now_ms(),
                "lastActiveAt": _now_ms(),
            })

    def close(self):
        """Close database connection (no-op for Convex HTTP client)."""
        pass

    # ==================== Project Management ====================

    def create_project(
        self,
        slug: str,
        name: str = None,
        description: str = None,
        reference_url: str = None
    ) -> str:
        """Create a new project and return its Convex ID."""
        # Build args, omitting None values (Convex doesn't accept null for optional fields)
        args = {
            "slug": slug,
            "name": name or slug,
            "userId": self._user_id,
            "mode": "copy" if reference_url else "create",
            "targetAspectRatio": "16:9",  # Default landscape
        }
        if description:
            args["description"] = description
        if reference_url:
            args["referenceVideoUrl"] = reference_url

        project_id = self._client.mutation("mutations/projects:create", args)
        return project_id

    def get_project(self, slug: str) -> dict | None:
        """Get project by slug."""
        result = self._client.query("queries/projects:getBySlug", {"slug": slug})
        if result:
            return self._convert_project(result)
        return None

    def get_or_create_project(self, slug: str, name: str = None) -> dict:
        """Get existing project or create new one."""
        project = self.get_project(slug)
        if not project:
            project_id = self.create_project(slug, name)
            project = {"id": project_id, "slug": slug, "name": name or slug}
        return project

    def list_projects(self) -> list[dict]:
        """List all projects for current user."""
        results = self._client.query("queries/projects:listByUser", {
            "userId": self._user_id
        })
        return [self._convert_project(p) for p in results]

    def _convert_project(self, p: dict) -> dict:
        """Convert Convex project to SQLite-compatible format."""
        return {
            "id": p["_id"],
            "slug": p.get("slug"),
            "name": p.get("name"),
            "description": p.get("description"),
            "reference_video_url": p.get("referenceVideoUrl"),
            "created_at": self._ms_to_iso(p.get("createdAt")),
            "updated_at": self._ms_to_iso(p.get("updatedAt")),
        }

    # ==================== Analysis Tracking ====================

    def save_analysis(
        self,
        project_id: str,
        analysis_json: dict,
        gemini_model: str = "gemini-1.5-pro"
    ) -> str:
        """Save SEALCAM+ analysis and return ID."""
        video_analysis = analysis_json.get("video_analysis", {})

        analysis_id = self._client.mutation("mutations/videoReplicator:createAnalysis", {
            "projectId": project_id,
            "sourceVideo": video_analysis.get("source_url", ""),
            "geminiModel": gemini_model,
            "framework": "SEALCAM+",
            "overallVibe": video_analysis.get("overall_vibe", ""),
            "totalDuration": video_analysis.get("total_duration", 0),
            "sceneCount": video_analysis.get("scene_count", 0),
            "pacing": video_analysis.get("pacing", ""),
            "brandCategory": video_analysis.get("brand_category", ""),
            "detectedAspectRatio": self._map_aspect_ratio(
                video_analysis.get("aspect_ratio", "16:9")
            ),
            "analysisJson": json.dumps(analysis_json),
            "createdAt": _now_ms(),
        })

        return analysis_id

    def get_latest_analysis(self, project_id: str) -> dict | None:
        """Get the most recent analysis for a project."""
        result = self._client.query("queries/videoReplicator:getLatestAnalysisByProject", {
            "projectId": project_id
        })
        if result:
            return self._convert_analysis(result)
        return None

    def _convert_analysis(self, a: dict) -> dict:
        """Convert Convex analysis to SQLite-compatible format."""
        return {
            "id": a["_id"],
            "project_id": a.get("projectId"),
            "analysis_json": json.loads(a.get("analysisJson", "{}")),
            "overall_vibe": a.get("overallVibe"),
            "total_duration": a.get("totalDuration"),
            "scene_count": a.get("sceneCount"),
            "pacing": a.get("pacing"),
            "brand_category": a.get("brandCategory"),
            "gemini_model": a.get("geminiModel"),
            "created_at": self._ms_to_iso(a.get("createdAt")),
        }

    # ==================== Scene Management ====================

    def save_scene(
        self,
        analysis_id: str,
        project_id: str,
        scene_data: dict
    ) -> str:
        """Save a scene from analysis and return ID."""
        # Serialize complex fields to JSON
        def to_json(val):
            if isinstance(val, (dict, list)):
                return json.dumps(val)
            return str(val) if val else ""

        scene_id = self._client.mutation("mutations/videoReplicator:createScene", {
            "projectId": project_id,
            "analysisId": analysis_id,
            "sceneNumber": scene_data.get("scene_number", 0),
            "timestamp": scene_data.get("timestamp", ""),
            "durationSeconds": scene_data.get("duration_seconds", 0),
            "subject": to_json(scene_data.get("subject")),
            "environment": to_json(scene_data.get("environment")),
            "action": to_json(scene_data.get("action")),
            "lighting": to_json(scene_data.get("lighting")),
            "camera": to_json(scene_data.get("camera")),
            "audio": to_json(scene_data.get("audio")),
            "metatokens": to_json(scene_data.get("metatokens")),
            "micromotion": to_json(scene_data.get("micromotion")),
            "imagePrompt": scene_data.get("image_prompt"),
            "generationPrompt": scene_data.get("generation_prompt"),
            "videoMotionPrompt": scene_data.get("video_motion_prompt"),
            "enhancedVideoPrompt": scene_data.get("enhanced_video_prompt"),
            "motionBrief": to_json(scene_data.get("motion_brief")),
            "createdAt": _now_ms(),
        })

        return scene_id

    def get_scenes_for_project(self, project_id: str) -> list[dict]:
        """Get all scenes for a project."""
        results = self._client.query("queries/videoReplicator:listScenesByProject", {
            "projectId": project_id
        })
        return [self._convert_scene(s) for s in results]

    def update_scene_prompts(self, scene_id: str, prompts: dict):
        """Update prompts for a scene."""
        update_data = {"sceneId": scene_id, "updatedAt": _now_ms()}

        field_map = {
            "image_prompt": "imagePrompt",
            "generation_prompt": "generationPrompt",
            "video_motion_prompt": "videoMotionPrompt",
            "enhanced_video_prompt": "enhancedVideoPrompt",
            "motion_brief_json": "motionBrief",
        }

        for sqlite_key, convex_key in field_map.items():
            if sqlite_key in prompts:
                val = prompts[sqlite_key]
                if isinstance(val, dict):
                    val = json.dumps(val)
                update_data[convex_key] = val

        self._client.mutation("mutations/videoReplicator:updateScenePrompts", update_data)

    def _convert_scene(self, s: dict) -> dict:
        """Convert Convex scene to SQLite-compatible format."""
        def parse_json(val):
            if val:
                try:
                    return json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    return val
            return None

        return {
            "id": s["_id"],
            "analysis_id": s.get("analysisId"),
            "project_id": s.get("projectId"),
            "scene_number": s.get("sceneNumber"),
            "duration_seconds": s.get("durationSeconds"),
            "subject": s.get("subject"),
            "environment": s.get("environment"),
            "action_json": parse_json(s.get("action")),
            "micromotion_json": parse_json(s.get("micromotion")),
            "lighting": s.get("lighting"),
            "camera_json": parse_json(s.get("camera")),
            "audio": s.get("audio"),
            "metatokens": s.get("metatokens"),
            "image_prompt": s.get("imagePrompt"),
            "generation_prompt": s.get("generationPrompt"),
            "video_motion_prompt": s.get("videoMotionPrompt"),
            "enhanced_video_prompt": s.get("enhancedVideoPrompt"),
            "motion_brief_json": parse_json(s.get("motionBrief")),
            "created_at": self._ms_to_iso(s.get("createdAt")),
        }

    # ==================== Image Tracking ====================

    def save_image(
        self,
        scene_id: str,
        project_id: str,
        scene_number: int,
        file_path: str,
        prompt: str,
        go_bananas_id: int = None,
        image_type: str = "start",
        width: int = None,
        height: int = None,
        aspect_ratio: str = None
    ) -> str:
        """Save an image record (as asset) and return ID."""
        asset_type = f"image_{image_type}"  # image_start, image_end, etc.

        asset_id = self._client.mutation("mutations/videoReplicator:createAsset", {
            "userId": self._user_id,
            "projectId": project_id,
            "sceneId": scene_id,
            "type": asset_type,
            "sceneNumber": scene_number,
            "fileName": os.path.basename(file_path) if file_path else "",
            "filePath": file_path,
            "mimeType": "image/jpeg",  # Default, could detect
            "width": width,
            "height": height,
            "aspectRatio": aspect_ratio,
            "goBananasImageId": go_bananas_id,
            "promptUsed": prompt,
            "createdAt": _now_ms(),
        })

        return asset_id

    def get_image_for_scene(
        self,
        scene_id: str,
        image_type: str = "start"
    ) -> dict | None:
        """Get image for a scene."""
        asset_type = f"image_{image_type}"
        result = self._client.query("queries/videoReplicator:getAssetBySceneAndType", {
            "sceneId": scene_id,
            "type": asset_type,
        })
        if result:
            return self._convert_image(result)
        return None

    def get_images_for_project(self, project_id: str) -> list[dict]:
        """Get all images for a project."""
        results = self._client.query("queries/videoReplicator:listImageAssetsByProject", {
            "projectId": project_id
        })
        return [self._convert_image(a) for a in results]

    def _convert_image(self, a: dict) -> dict:
        """Convert Convex asset to SQLite image format."""
        # Extract image_type from asset type (e.g., "image_start" -> "start")
        asset_type = a.get("type", "image_start")
        image_type = asset_type.replace("image_", "") if asset_type.startswith("image_") else "start"

        return {
            "id": a["_id"],
            "scene_id": a.get("sceneId"),
            "project_id": a.get("projectId"),
            "scene_number": a.get("sceneNumber"),
            "image_type": image_type,
            "file_path": a.get("filePath"),
            "go_bananas_image_id": a.get("goBananasImageId"),
            "prompt_used": a.get("promptUsed"),
            "width": a.get("width"),
            "height": a.get("height"),
            "aspect_ratio": a.get("aspectRatio"),
            "created_at": self._ms_to_iso(a.get("createdAt")),
        }

    # ==================== Video Tracking ====================

    def start_video_generation(
        self,
        scene_id: str,
        project_id: str,
        scene_number: int,
        image_id: str,
        prompt: str,
        model: str = "veo",
        quality: str = "fast",
        mode: str = "i2v",
        aspect_ratio: str = "landscape"
    ) -> str:
        """Start tracking a video generation and return ID."""
        # First create a job in the jobs table
        job_id = self._client.mutation("mutations/videoReplicator:createJob", {
            "userId": self._user_id,
            "projectId": project_id,
            "sceneId": scene_id,
            "promptIndex": scene_number,
            "promptText": prompt,
            "promptType": self._map_mode_to_prompt_type(mode),
            "status": "running",
            "retryCount": 0,
            "maxRetries": 3,
            "createdAt": _now_ms(),
            "startedAt": _now_ms(),
        })

        return job_id

    def complete_video(
        self,
        video_id: str,
        file_path: str,
        variant: str = "primary",
        generation_time: float = None,
        credits: int = None,
        veo_batch_id: int = None,
        veo_job_id: int = None
    ):
        """Mark a video as completed."""
        now = _now_ms()

        update_data = {
            "jobId": video_id,
            "status": "completed",
            "completedAt": now,
        }

        if variant == "primary":
            update_data["videoPath"] = file_path
        else:
            update_data["altVideoPath"] = file_path

        if generation_time:
            update_data["durationMs"] = int(generation_time * 1000)
        if credits:
            update_data["creditsUsed"] = credits

        self._client.mutation("mutations/videoReplicator:updateJob", update_data)

        # Also create an asset record for the video
        self._client.mutation("mutations/videoReplicator:createAsset", {
            "userId": self._user_id,
            "jobId": video_id,
            "type": "video_primary" if variant == "primary" else "video_alt",
            "variant": variant,
            "fileName": os.path.basename(file_path) if file_path else "",
            "filePath": file_path,
            "mimeType": "video/mp4",
            "createdAt": now,
        })

    def fail_video(self, video_id: str, error_message: str):
        """Mark a video as failed."""
        self._client.mutation("mutations/videoReplicator:updateJob", {
            "jobId": video_id,
            "status": "failed",
            "errorMessage": error_message,
            "completedAt": _now_ms(),
        })

    def rate_video(
        self,
        video_id: str,
        motion_score: float = None,
        prompt_score: float = None,
        visual_score: float = None,
        notes: str = None
    ):
        """Rate a video's quality."""
        update_data = {"jobId": video_id}

        if motion_score is not None:
            update_data["motionScore"] = int(motion_score * 100)  # Convert to 0-100
        if prompt_score is not None:
            update_data["promptAdherenceScore"] = int(prompt_score * 100)
        if visual_score is not None:
            update_data["visualQualityScore"] = int(visual_score * 100)

        self._client.mutation("mutations/videoReplicator:updateJob", update_data)

    def get_videos_for_project(
        self,
        project_id: str,
        status: str = None
    ) -> list[dict]:
        """Get videos for a project, optionally filtered by status."""
        if status:
            results = self._client.query("queries/videoReplicator:listJobsByProjectAndStatus", {
                "projectId": project_id,
                "status": status,
            })
        else:
            results = self._client.query("queries/videoReplicator:listJobsByProject", {
                "projectId": project_id
            })

        return [self._convert_video(j) for j in results]

    def _convert_video(self, j: dict) -> dict:
        """Convert Convex job to SQLite video format."""
        return {
            "id": j["_id"],
            "scene_id": j.get("sceneId"),
            "image_id": None,  # Not stored in Convex
            "project_id": j.get("projectId"),
            "scene_number": j.get("promptIndex"),
            "variant": "primary",  # Would need asset lookup for full info
            "file_path": j.get("videoPath"),
            "veo_batch_id": None,
            "veo_job_id": None,
            "prompt_used": j.get("promptText"),
            "model": None,
            "quality": None,
            "aspect_ratio": None,
            "mode": self._prompt_type_to_mode(j.get("promptType", "text")),
            "credits_used": j.get("creditsUsed"),
            "generation_time_seconds": (j.get("durationMs") or 0) / 1000,
            "motion_accuracy_score": (j.get("motionScore") or 0) / 100,
            "prompt_adherence_score": (j.get("promptAdherenceScore") or 0) / 100,
            "visual_quality_score": (j.get("visualQualityScore") or 0) / 100,
            "notes": None,
            "status": j.get("status"),
            "error_message": j.get("errorMessage"),
            "created_at": self._ms_to_iso(j.get("createdAt")),
            "completed_at": self._ms_to_iso(j.get("completedAt")),
        }

    # ==================== Knowledge Base ====================

    def learn_from_success(
        self,
        pattern_type: str,
        pattern_name: str,
        prompt_fragment: str,
        settings: dict = None,
        quality_score: float = None
    ):
        """Record a successful pattern."""
        # Try to find existing pattern
        existing = self._client.query("queries/videoReplicator:getPatternByTypeName", {
            "patternType": pattern_type,
            "patternName": pattern_name,
        })

        if existing:
            # Update existing pattern
            effective_prompts = existing.get("effectivePrompts", [])
            if prompt_fragment not in effective_prompts:
                effective_prompts.append(prompt_fragment)

            new_count = existing["successCount"] + 1
            old_avg = existing.get("avgQualityScore", 0) or 0
            if quality_score:
                new_avg = (old_avg * existing["successCount"] + quality_score) / new_count
            else:
                new_avg = old_avg

            self._client.mutation("mutations/videoReplicator:updatePattern", {
                "patternId": existing["_id"],
                "effectivePrompts": effective_prompts,
                "successCount": new_count,
                "avgQualityScore": new_avg,
                "updatedAt": _now_ms(),
            })
        else:
            # Create new pattern
            self._client.mutation("mutations/videoReplicator:createPattern", {
                "patternType": pattern_type,
                "patternName": pattern_name,
                "description": "",
                "effectivePrompts": [prompt_fragment],
                "avoidPrompts": [],
                "effectiveSettings": json.dumps(settings) if settings else None,
                "successCount": 1,
                "failureCount": 0,
                "avgQualityScore": quality_score,
                "createdAt": _now_ms(),
                "updatedAt": _now_ms(),
            })

    def learn_from_failure(
        self,
        pattern_type: str,
        pattern_name: str,
        prompt_fragment: str
    ):
        """Record a failed pattern."""
        existing = self._client.query("queries/videoReplicator:getPatternByTypeName", {
            "patternType": pattern_type,
            "patternName": pattern_name,
        })

        if existing:
            avoid_prompts = existing.get("avoidPrompts", [])
            if prompt_fragment not in avoid_prompts:
                avoid_prompts.append(prompt_fragment)

            self._client.mutation("mutations/videoReplicator:updatePattern", {
                "patternId": existing["_id"],
                "avoidPrompts": avoid_prompts,
                "failureCount": existing["failureCount"] + 1,
                "updatedAt": _now_ms(),
            })
        else:
            self._client.mutation("mutations/videoReplicator:createPattern", {
                "patternType": pattern_type,
                "patternName": pattern_name,
                "description": "",
                "effectivePrompts": [],
                "avoidPrompts": [prompt_fragment],
                "successCount": 0,
                "failureCount": 1,
                "createdAt": _now_ms(),
                "updatedAt": _now_ms(),
            })

    def get_effective_patterns(
        self,
        pattern_type: str,
        limit: int = 10
    ) -> list[dict]:
        """Get patterns sorted by success rate."""
        results = self._client.query("queries/videoReplicator:listEffectivePatterns", {
            "patternType": pattern_type,
            "limit": limit,
        })
        return [self._convert_pattern(p) for p in results]

    def get_avoid_patterns(self, pattern_type: str) -> list[str]:
        """Get list of prompt fragments to avoid."""
        results = self._client.query("queries/videoReplicator:listAvoidPrompts", {
            "patternType": pattern_type,
        })

        avoid_list = []
        for p in results:
            avoid_prompts = p.get("avoidPrompts", [])
            avoid_list.extend(avoid_prompts)

        return list(set(avoid_list))

    def _convert_pattern(self, p: dict) -> dict:
        """Convert Convex pattern to SQLite format."""
        def parse_json(val):
            if val:
                try:
                    return json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    return val
            return None

        return {
            "id": p["_id"],
            "pattern_type": p.get("patternType"),
            "pattern_name": p.get("patternName"),
            "description": p.get("description"),
            "effective_prompts": p.get("effectivePrompts", []),
            "effective_settings": parse_json(p.get("effectiveSettings")),
            "avoid_prompts": p.get("avoidPrompts", []),
            "success_count": p.get("successCount", 0),
            "failure_count": p.get("failureCount", 0),
            "avg_quality_score": p.get("avgQualityScore"),
            "created_at": self._ms_to_iso(p.get("createdAt")),
            "updated_at": self._ms_to_iso(p.get("updatedAt")),
        }

    # ==================== Screenplay Management (v2.37) ====================

    def save_screenplay(self, project_id: str, concept: str, genre: str = None,
                        target_duration: float = None, scene_count: int = None,
                        outline_json: str = None, screenplay_json: str = None,
                        current_phase: str = "concept") -> str:
        """Create a screenplay and return its Convex ID."""
        now = _now_ms()
        args = {
            "projectId": project_id,
            "userId": self._user_id,
            "concept": concept,
            "targetDuration": target_duration or 0,
            "sceneCount": scene_count or 0,
            "currentPhase": current_phase,
            "createdAt": now,
            "updatedAt": now,
        }
        if genre:
            args["genre"] = genre
        if outline_json:
            args["outlineJson"] = json.dumps(outline_json) if isinstance(outline_json, (dict, list)) else outline_json
        if screenplay_json:
            args["screenplayJson"] = json.dumps(screenplay_json) if isinstance(screenplay_json, (dict, list)) else screenplay_json
        return self._client.mutation("mutations/videoReplicator:createScreenplay", args)

    def get_screenplay(self, project_id: str) -> dict | None:
        """Get the latest screenplay for a project."""
        result = self._client.query("queries/videoReplicator:getScreenplayByProject", {
            "projectId": project_id
        })
        if result:
            return self._convert_screenplay(result)
        return None

    def update_screenplay(self, screenplay_id: str, **fields):
        """Update screenplay fields."""
        args = {"screenplayId": screenplay_id, "updatedAt": _now_ms()}
        field_map = {
            "concept": "concept", "genre": "genre",
            "target_duration": "targetDuration", "scene_count": "sceneCount",
            "outline_json": "outlineJson", "screenplay_json": "screenplayJson",
            "current_phase": "currentPhase",
        }
        for py_key, convex_key in field_map.items():
            if py_key in fields:
                val = fields[py_key]
                if isinstance(val, (dict, list)):
                    val = json.dumps(val)
                args[convex_key] = val
        self._client.mutation("mutations/videoReplicator:updateScreenplay", args)

    def _convert_screenplay(self, s: dict) -> dict:
        """Convert Convex screenplay to SQLite-compatible format."""
        def parse_json(val):
            if val:
                try:
                    return json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    return val
            return None
        return {
            "id": s["_id"],
            "project_id": s.get("projectId"),
            "concept": s.get("concept"),
            "genre": s.get("genre"),
            "target_duration": s.get("targetDuration"),
            "scene_count": s.get("sceneCount"),
            "outline_json": parse_json(s.get("outlineJson")),
            "screenplay_json": parse_json(s.get("screenplayJson")),
            "current_phase": s.get("currentPhase"),
            "created_at": self._ms_to_iso(s.get("createdAt")),
            "updated_at": self._ms_to_iso(s.get("updatedAt")),
        }

    # ==================== Film Character Management (v2.37) ====================

    def save_film_character(self, project_id: str, name: str, role: str = "supporting",
                            description: str = None, screenplay_id: str = None,
                            age: int = None, gender: str = None,
                            voice_id: str = None, voice_name: str = None,
                            go_bananas_character_id: int = None,
                            go_bananas_image_url: str = None,
                            character_json: str = None) -> str:
        """Create a film character and return its Convex ID."""
        now = _now_ms()
        args = {
            "projectId": project_id,
            "name": name,
            "role": role,
            "description": description or "",
            "createdAt": now,
            "updatedAt": now,
        }
        if screenplay_id:
            args["screenplayId"] = screenplay_id
        if age is not None:
            args["age"] = age
        if gender:
            args["gender"] = gender
        if voice_id:
            args["voiceId"] = voice_id
        if voice_name:
            args["voiceName"] = voice_name
        if go_bananas_character_id is not None:
            args["goBananasCharacterId"] = go_bananas_character_id
        if go_bananas_image_url:
            args["goBananasImageUrl"] = go_bananas_image_url
        if character_json:
            args["characterJson"] = json.dumps(character_json) if isinstance(character_json, (dict, list)) else character_json
        return self._client.mutation("mutations/videoReplicator:createFilmCharacter", args)

    def get_film_characters(self, project_id: str) -> list[dict]:
        """Get all film characters for a project."""
        results = self._client.query("queries/videoReplicator:listFilmCharactersByProject", {
            "projectId": project_id
        })
        return [self._convert_film_character(c) for c in results]

    def get_film_character_by_name(self, project_id: str, name: str) -> dict | None:
        """Get a film character by project and name."""
        result = self._client.query("queries/videoReplicator:getFilmCharacterByName", {
            "projectId": project_id,
            "name": name,
        })
        if result:
            return self._convert_film_character(result)
        return None

    def update_film_character(self, character_id: str, **fields):
        """Update film character fields."""
        args = {"characterId": character_id, "updatedAt": _now_ms()}
        field_map = {
            "name": "name", "role": "role", "description": "description",
            "age": "age", "gender": "gender",
            "voice_id": "voiceId", "voice_name": "voiceName",
            "go_bananas_character_id": "goBananasCharacterId",
            "go_bananas_image_url": "goBananasImageUrl",
            "character_json": "characterJson",
        }
        for py_key, convex_key in field_map.items():
            if py_key in fields:
                val = fields[py_key]
                if isinstance(val, (dict, list)):
                    val = json.dumps(val)
                args[convex_key] = val
        self._client.mutation("mutations/videoReplicator:updateFilmCharacter", args)

    def _convert_film_character(self, c: dict) -> dict:
        """Convert Convex film character to SQLite-compatible format."""
        def parse_json(val):
            if val:
                try:
                    return json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    return val
            return None
        return {
            "id": c["_id"],
            "project_id": c.get("projectId"),
            "screenplay_id": c.get("screenplayId"),
            "name": c.get("name"),
            "role": c.get("role"),
            "description": c.get("description"),
            "age": c.get("age"),
            "gender": c.get("gender"),
            "voice_id": c.get("voiceId"),
            "voice_name": c.get("voiceName"),
            "go_bananas_character_id": c.get("goBananasCharacterId"),
            "go_bananas_image_url": c.get("goBananasImageUrl"),
            "character_json": parse_json(c.get("characterJson")),
            "created_at": self._ms_to_iso(c.get("createdAt")),
            "updated_at": self._ms_to_iso(c.get("updatedAt")),
        }

    # ==================== Analytics ====================

    def get_project_stats(self, project_id: str) -> dict:
        """Get generation statistics for a project."""
        stats = self._client.query("queries/videoReplicator:getProjectStats", {
            "projectId": project_id
        })

        return {
            "videos": {
                "total_videos": stats.get("totalVideos", 0),
                "completed": stats.get("completedVideos", 0),
                "failed": stats.get("failedVideos", 0),
                "total_credits": stats.get("totalCredits", 0),
                "avg_gen_time": stats.get("avgGenTime"),
                "avg_motion_score": stats.get("avgMotionScore"),
                "avg_prompt_score": stats.get("avgPromptScore"),
                "avg_visual_score": stats.get("avgVisualScore"),
            },
            "scenes": {
                "total_scenes": stats.get("totalScenes", 0),
            },
            "images": {
                "total_images": stats.get("totalImages", 0),
            },
        }

    def get_overall_stats(self) -> dict:
        """Get overall system statistics."""
        stats = self._client.query("queries/videoReplicator:getUserStats", {
            "userId": self._user_id
        })

        return {
            "projects": stats.get("projectCount", 0),
            "videos": {
                "total": stats.get("totalVideos", 0),
                "completed": stats.get("completedVideos", 0),
                "credits": stats.get("totalCredits", 0),
            },
            "learned_patterns": stats.get("patternCount", 0),
        }

    def get_best_performing_prompts(self, limit: int = 10) -> list[dict]:
        """Get prompts with highest quality scores."""
        results = self._client.query("queries/videoReplicator:listBestPromptsByUser", {
            "userId": self._user_id,
            "limit": limit,
        })

        return [{
            "prompt_used": r.get("promptText"),
            "mode": self._prompt_type_to_mode(r.get("promptType", "text")),
            "avg_motion": (r.get("motionScore") or 0) / 100,
            "avg_prompt": (r.get("promptAdherenceScore") or 0) / 100,
            "avg_visual": (r.get("visualQualityScore") or 0) / 100,
            "usage_count": r.get("usageCount", 1),
        } for r in results]

    # ==================== Utility Methods ====================

    def _ms_to_iso(self, ms: int) -> str | None:
        """Convert milliseconds timestamp to ISO string."""
        if ms:
            return datetime.fromtimestamp(ms / 1000).isoformat()
        return None

    def _map_aspect_ratio(self, ratio: str) -> str:
        """Map aspect ratio to Convex enum value."""
        mapping = {
            "landscape": "16:9",
            "portrait": "9:16",
            "square": "1:1",
            "16:9": "16:9",
            "9:16": "9:16",
            "1:1": "1:1",
        }
        return mapping.get(ratio.lower(), "16:9")

    def _map_mode_to_prompt_type(self, mode: str) -> str:
        """Map video mode to Convex prompt type."""
        mapping = {
            "t2v": "text",
            "text": "text",
            "i2v": "image",
            "image": "image",
            "f2v": "frames",
            "frames": "frames",
            "r2v": "ingredients",
            "ingredients": "ingredients",
        }
        return mapping.get(mode.lower(), "text")

    def _prompt_type_to_mode(self, prompt_type: str) -> str:
        """Map Convex prompt type to video mode."""
        mapping = {
            "text": "t2v",
            "image": "i2v",
            "frames": "f2v",
            "ingredients": "r2v",
        }
        return mapping.get(prompt_type.lower(), "t2v")


# CLI interface for direct usage
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Video Replicator Convex Database")
    parser.add_argument("command", choices=["init", "status", "stats", "projects", "best-prompts"])
    parser.add_argument("--project", help="Project slug")
    parser.add_argument("--limit", type=int, default=10, help="Limit results")
    args = parser.parse_args()

    try:
        db = VideoReplicatorConvexDB()
    except Exception as e:
        print(f"Error connecting to Convex: {e}")
        print("\nMake sure CONVEX_URL environment variable is set:")
        print("  export CONVEX_URL=https://your-project.convex.cloud")
        exit(1)

    if args.command == "init":
        print(f"Connected to Convex at: {os.environ.get('CONVEX_URL')}")
        print("User ID:", db._user_id)

    elif args.command == "status":
        if args.project:
            project = db.get_project(args.project)
            if project:
                stats = db.get_project_stats(project["id"])
                print(f"\nProject: {project['name']} ({project['slug']})")
                print(f"  Scenes: {stats['scenes']['total_scenes']}")
                print(f"  Images: {stats['images']['total_images']}")
                print(f"  Videos: {stats['videos']['total_videos']} "
                      f"({stats['videos']['completed']} completed, "
                      f"{stats['videos']['failed']} failed)")
                if stats['videos']['total_credits']:
                    print(f"  Credits used: {stats['videos']['total_credits']}")
            else:
                print(f"Project not found: {args.project}")
        else:
            print("Use --project to specify a project")

    elif args.command == "stats":
        stats = db.get_overall_stats()
        print("\n=== Video Replicator Stats (Convex) ===")
        print(f"Projects: {stats['projects']}")
        print(f"Videos: {stats['videos']['total']} "
              f"({stats['videos']['completed']} completed)")
        print(f"Learned patterns: {stats['learned_patterns']}")

    elif args.command == "projects":
        projects = db.list_projects()
        print("\n=== Projects ===")
        for p in projects:
            print(f"  {p['slug']}: {p['name']}")

    elif args.command == "best-prompts":
        prompts = db.get_best_performing_prompts(args.limit)
        print(f"\n=== Top {args.limit} Prompts ===")
        for i, p in enumerate(prompts, 1):
            score = sum(filter(None, [p['avg_motion'], p['avg_prompt'], p['avg_visual']])) / 3
            print(f"{i}. [{p['mode']}] Score: {score:.2f} (used {p['usage_count']}x)")
            prompt_text = p['prompt_used'] or ""
            print(f"   {prompt_text[:80]}...")

    db.close()
