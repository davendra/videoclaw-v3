#!/usr/bin/env python3
"""
SQLite Database Manager for Video Replicator
Tracks projects, analyses, scenes, images, videos, and learned patterns.

Usage:
    from db import VideoReplicatorDB
    db = VideoReplicatorDB()
    db.create_project("prada-snow", "Prada Snow Campaign")
"""

import contextlib
import json
import sqlite3
from datetime import datetime
from pathlib import Path

# Default database path (in project root)
DEFAULT_DB_PATH = Path(__file__).parent.parent.parent.parent.parent / "video-replicator.db"


class VideoReplicatorDB:
    """SQLite database manager for video replicator tracking and knowledge base."""

    def __init__(self, db_path: Path = DEFAULT_DB_PATH):
        self.db_path = db_path
        self.conn = sqlite3.connect(str(db_path))
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self):
        """Create tables if they don't exist."""
        cursor = self.conn.cursor()

        # Projects table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY,
                slug TEXT UNIQUE NOT NULL,
                name TEXT,
                description TEXT,
                reference_video_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Analyses table (SEALCAM+ analysis results)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS analyses (
                id INTEGER PRIMARY KEY,
                project_id INTEGER REFERENCES projects(id),
                analysis_json TEXT NOT NULL,
                overall_vibe TEXT,
                total_duration REAL,
                scene_count INTEGER,
                pacing TEXT,
                brand_category TEXT,
                gemini_model TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Scenes table (individual scenes from analysis)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS scenes (
                id INTEGER PRIMARY KEY,
                analysis_id INTEGER REFERENCES analyses(id),
                project_id INTEGER REFERENCES projects(id),
                scene_number INTEGER,
                duration_seconds REAL,

                -- SEALCAM+ fields
                subject TEXT,
                environment TEXT,
                action_json TEXT,
                micromotion_json TEXT,
                lighting TEXT,
                camera_json TEXT,
                audio TEXT,
                metatokens TEXT,

                -- Generated prompts
                image_prompt TEXT,
                generation_prompt TEXT,
                video_motion_prompt TEXT,
                enhanced_video_prompt TEXT,
                motion_brief_json TEXT,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # First-frame images
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS images (
                id INTEGER PRIMARY KEY,
                scene_id INTEGER REFERENCES scenes(id),
                project_id INTEGER REFERENCES projects(id),
                scene_number INTEGER,
                image_type TEXT DEFAULT 'start',

                file_path TEXT,
                go_bananas_image_id INTEGER,
                prompt_used TEXT,

                width INTEGER,
                height INTEGER,
                aspect_ratio TEXT,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Generated videos
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS videos (
                id INTEGER PRIMARY KEY,
                scene_id INTEGER REFERENCES scenes(id),
                image_id INTEGER REFERENCES images(id),
                project_id INTEGER REFERENCES projects(id),
                scene_number INTEGER,
                variant TEXT,

                file_path TEXT,
                veo_batch_id INTEGER,
                veo_job_id INTEGER,

                -- Generation parameters
                prompt_used TEXT,
                model TEXT,
                quality TEXT,
                aspect_ratio TEXT,
                mode TEXT,
                credits_used INTEGER,
                generation_time_seconds REAL,

                -- Quality assessment
                motion_accuracy_score REAL,
                prompt_adherence_score REAL,
                visual_quality_score REAL,
                notes TEXT,

                status TEXT DEFAULT 'pending',
                error_message TEXT,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP
            )
        """)

        # Final stitched outputs
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS outputs (
                id INTEGER PRIMARY KEY,
                project_id INTEGER REFERENCES projects(id),
                variant TEXT,

                file_path TEXT,
                audio_path TEXT,
                total_duration REAL,
                file_size_bytes INTEGER,

                overall_score REAL,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Prompt effectiveness tracking (for learning)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS prompt_experiments (
                id INTEGER PRIMARY KEY,
                scene_id INTEGER REFERENCES scenes(id),

                prompt_version TEXT,
                prompt_text TEXT,
                prompt_type TEXT,

                video_id INTEGER REFERENCES videos(id),
                success INTEGER,
                quality_score REAL,
                notes TEXT,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Knowledge base: successful patterns
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS learned_patterns (
                id INTEGER PRIMARY KEY,
                pattern_type TEXT,
                pattern_name TEXT,
                description TEXT,

                effective_prompts TEXT,
                effective_settings TEXT,
                avoid_prompts TEXT,

                success_count INTEGER DEFAULT 0,
                failure_count INTEGER DEFAULT 0,
                avg_quality_score REAL,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Screenplays table (v2.37 — Film Pipeline)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS screenplays (
                id INTEGER PRIMARY KEY,
                project_id INTEGER REFERENCES projects(id),
                concept TEXT NOT NULL,
                genre TEXT,
                target_duration REAL,
                scene_count INTEGER,
                outline_json TEXT,
                screenplay_json TEXT,
                current_phase TEXT DEFAULT 'concept',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Film characters table (v2.37 — Film Pipeline)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS film_characters (
                id INTEGER PRIMARY KEY,
                project_id INTEGER REFERENCES projects(id),
                screenplay_id INTEGER REFERENCES screenplays(id),
                name TEXT NOT NULL,
                role TEXT DEFAULT 'supporting',
                description TEXT,
                age INTEGER,
                gender TEXT,
                voice_id TEXT,
                voice_name TEXT,
                go_bananas_character_id INTEGER,
                go_bananas_image_url TEXT,
                character_json TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Run-level telemetry summaries
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS run_telemetry (
                id               INTEGER PRIMARY KEY,
                project_slug     TEXT NOT NULL,
                run_id           TEXT NOT NULL,
                backend          TEXT,
                started_at       TIMESTAMP,
                completed_at     TIMESTAMP,
                total_scenes     INTEGER,
                success_count    INTEGER,
                failed_count     INTEGER,
                total_credits    INTEGER,
                total_duration_s REAL,
                jsonl_path       TEXT,
                UNIQUE(project_slug, run_id)
            )
        """)

        # Add telemetry columns to videos table (backward-compatible)
        for col_def in [
            "retry_count        INTEGER DEFAULT 0",
            "quality_fallback   INTEGER DEFAULT 0",
            "content_violations INTEGER DEFAULT 0",
            "upload_service     TEXT",
            "failure_reason     TEXT",
        ]:
            try:
                cursor.execute(f"ALTER TABLE videos ADD COLUMN {col_def}")
            except Exception:
                pass  # Column already exists — safe to ignore

        # Create indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_videos_project ON videos(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_learned_patterns_type ON learned_patterns(pattern_type)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_scene ON images(scene_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_screenplays_project ON screenplays(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_film_characters_project ON film_characters(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_film_characters_screenplay ON film_characters(screenplay_id)")

        self.conn.commit()

    def close(self):
        """Close database connection."""
        self.conn.close()

    # ==================== Project Management ====================

    def create_project(self, slug: str, name: str = None, description: str = None,
                       reference_url: str = None) -> int:
        """Create a new project and return its ID."""
        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT INTO projects (slug, name, description, reference_video_url)
            VALUES (?, ?, ?, ?)
        """, (slug, name or slug, description, reference_url))
        self.conn.commit()
        return cursor.lastrowid

    def get_project(self, slug: str) -> dict | None:
        """Get project by slug."""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM projects WHERE slug = ?", (slug,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def get_or_create_project(self, slug: str, name: str = None) -> dict:
        """Get existing project or create new one."""
        project = self.get_project(slug)
        if not project:
            project_id = self.create_project(slug, name)
            project = {"id": project_id, "slug": slug, "name": name or slug}
        return project

    def list_projects(self) -> list[dict]:
        """List all projects."""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM projects ORDER BY created_at DESC")
        return [dict(row) for row in cursor.fetchall()]

    # ==================== Analysis Tracking ====================

    def save_analysis(self, project_id: int, analysis_json: dict,
                      gemini_model: str = "gemini-1.5-pro") -> int:
        """Save SEALCAM+ analysis and return ID."""
        cursor = self.conn.cursor()

        video_analysis = analysis_json.get("video_analysis", {})

        cursor.execute("""
            INSERT INTO analyses (
                project_id, analysis_json, overall_vibe, total_duration,
                scene_count, pacing, brand_category, gemini_model
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            project_id,
            json.dumps(analysis_json),
            video_analysis.get("overall_vibe"),
            video_analysis.get("total_duration"),
            video_analysis.get("scene_count"),
            video_analysis.get("pacing"),
            video_analysis.get("brand_category"),
            gemini_model
        ))
        self.conn.commit()
        return cursor.lastrowid

    def get_latest_analysis(self, project_id: int) -> dict | None:
        """Get the most recent analysis for a project."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM analyses
            WHERE project_id = ?
            ORDER BY created_at DESC LIMIT 1
        """, (project_id,))
        row = cursor.fetchone()
        if row:
            result = dict(row)
            result["analysis_json"] = json.loads(result["analysis_json"])
            return result
        return None

    # ==================== Scene Management ====================

    def save_scene(self, analysis_id: int, project_id: int, scene_data: dict) -> int:
        """Save a scene from analysis and return ID."""
        cursor = self.conn.cursor()

        # Handle structured action/camera/micromotion
        action_json = scene_data.get("action")
        if isinstance(action_json, dict):
            action_json = json.dumps(action_json)
        elif isinstance(action_json, str):
            action_json = json.dumps({"primary": action_json})

        camera_json = scene_data.get("camera")
        if isinstance(camera_json, dict):
            camera_json = json.dumps(camera_json)
        elif isinstance(camera_json, str):
            camera_json = json.dumps({"description": camera_json})

        micromotion_json = scene_data.get("micromotion", {})
        if isinstance(micromotion_json, dict):
            micromotion_json = json.dumps(micromotion_json)

        motion_brief = scene_data.get("motion_brief", {})
        if isinstance(motion_brief, dict):
            motion_brief = json.dumps(motion_brief)

        # Serialize all potentially dict fields to JSON
        def to_json_str(val):
            if isinstance(val, (dict, list)):
                return json.dumps(val)
            return val

        subject_json = to_json_str(scene_data.get("subject"))
        environment_json = to_json_str(scene_data.get("environment"))
        lighting_json = to_json_str(scene_data.get("lighting"))
        audio_json = to_json_str(scene_data.get("audio"))
        metatokens_json = to_json_str(scene_data.get("metatokens"))

        cursor.execute("""
            INSERT INTO scenes (
                analysis_id, project_id, scene_number, duration_seconds,
                subject, environment, action_json, micromotion_json,
                lighting, camera_json, audio, metatokens,
                image_prompt, generation_prompt, video_motion_prompt,
                enhanced_video_prompt, motion_brief_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            analysis_id,
            project_id,
            scene_data.get("scene_number"),
            scene_data.get("duration_seconds"),
            subject_json,
            environment_json,
            action_json,
            micromotion_json,
            lighting_json,
            camera_json,
            audio_json,
            metatokens_json,
            scene_data.get("image_prompt"),
            scene_data.get("generation_prompt"),
            scene_data.get("video_motion_prompt"),
            scene_data.get("enhanced_video_prompt"),
            motion_brief
        ))
        self.conn.commit()
        return cursor.lastrowid

    def get_scenes_for_project(self, project_id: int) -> list[dict]:
        """Get all scenes for a project."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM scenes
            WHERE project_id = ?
            ORDER BY scene_number
        """, (project_id,))
        scenes = []
        for row in cursor.fetchall():
            scene = dict(row)
            # Parse JSON fields
            for field in ["action_json", "camera_json", "micromotion_json", "motion_brief_json"]:
                if scene.get(field):
                    with contextlib.suppress(json.JSONDecodeError):
                        scene[field] = json.loads(scene[field])
            scenes.append(scene)
        return scenes

    def update_scene_prompts(self, scene_id: int, prompts: dict):
        """Update prompts for a scene."""
        cursor = self.conn.cursor()

        fields = []
        values = []
        for key in ["image_prompt", "generation_prompt", "video_motion_prompt",
                    "enhanced_video_prompt", "motion_brief_json"]:
            if key in prompts:
                fields.append(f"{key} = ?")
                val = prompts[key]
                if isinstance(val, dict):
                    val = json.dumps(val)
                values.append(val)

        if fields:
            values.append(scene_id)
            cursor.execute(f"""
                UPDATE scenes SET {', '.join(fields)} WHERE id = ?
            """, values)
            self.conn.commit()

    # ==================== Image Tracking ====================

    def save_image(self, scene_id: int, project_id: int, scene_number: int,
                   file_path: str, prompt: str, go_bananas_id: int = None,
                   image_type: str = "start", width: int = None, height: int = None,
                   aspect_ratio: str = None) -> int:
        """Save an image record and return ID."""
        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT INTO images (
                scene_id, project_id, scene_number, image_type,
                file_path, go_bananas_image_id, prompt_used,
                width, height, aspect_ratio
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            scene_id, project_id, scene_number, image_type,
            file_path, go_bananas_id, prompt,
            width, height, aspect_ratio
        ))
        self.conn.commit()
        return cursor.lastrowid

    def get_image_for_scene(self, scene_id: int, image_type: str = "start") -> dict | None:
        """Get image for a scene."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM images
            WHERE scene_id = ? AND image_type = ?
            ORDER BY created_at DESC LIMIT 1
        """, (scene_id, image_type))
        row = cursor.fetchone()
        return dict(row) if row else None

    def get_images_for_project(self, project_id: int) -> list[dict]:
        """Get all images for a project."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM images
            WHERE project_id = ?
            ORDER BY scene_number, image_type
        """, (project_id,))
        return [dict(row) for row in cursor.fetchall()]

    # ==================== Video Tracking ====================

    def start_video_generation(self, scene_id: int, project_id: int, scene_number: int,
                                image_id: int, prompt: str, model: str = "veo",
                                quality: str = "fast", mode: str = "i2v",
                                aspect_ratio: str = "landscape") -> int:
        """Start tracking a video generation and return ID."""
        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT INTO videos (
                scene_id, project_id, scene_number, image_id,
                prompt_used, model, quality, mode, aspect_ratio,
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'generating')
        """, (
            scene_id, project_id, scene_number, image_id,
            prompt, model, quality, mode, aspect_ratio
        ))
        self.conn.commit()
        return cursor.lastrowid

    def complete_video(self, video_id: int, file_path: str, variant: str = "primary",
                       generation_time: float = None, credits: int = None,
                       veo_batch_id: int = None, veo_job_id: int = None):
        """Mark a video as completed."""
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE videos SET
                file_path = ?,
                variant = ?,
                generation_time_seconds = ?,
                credits_used = ?,
                veo_batch_id = ?,
                veo_job_id = ?,
                status = 'completed',
                completed_at = ?
            WHERE id = ?
        """, (
            file_path, variant, generation_time, credits,
            veo_batch_id, veo_job_id,
            datetime.now().isoformat(),
            video_id
        ))
        self.conn.commit()

    def fail_video(self, video_id: int, error_message: str):
        """Mark a video as failed."""
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE videos SET
                status = 'failed',
                error_message = ?,
                completed_at = ?
            WHERE id = ?
        """, (error_message, datetime.now().isoformat(), video_id))
        self.conn.commit()

    def rate_video(self, video_id: int, motion_score: float = None,
                   prompt_score: float = None, visual_score: float = None,
                   notes: str = None):
        """Rate a video's quality."""
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE videos SET
                motion_accuracy_score = COALESCE(?, motion_accuracy_score),
                prompt_adherence_score = COALESCE(?, prompt_adherence_score),
                visual_quality_score = COALESCE(?, visual_quality_score),
                notes = COALESCE(?, notes)
            WHERE id = ?
        """, (motion_score, prompt_score, visual_score, notes, video_id))
        self.conn.commit()

    def get_videos_for_project(self, project_id: int, status: str = None) -> list[dict]:
        """Get videos for a project, optionally filtered by status."""
        cursor = self.conn.cursor()
        if status:
            cursor.execute("""
                SELECT * FROM videos
                WHERE project_id = ? AND status = ?
                ORDER BY scene_number, variant
            """, (project_id, status))
        else:
            cursor.execute("""
                SELECT * FROM videos
                WHERE project_id = ?
                ORDER BY scene_number, variant
            """, (project_id,))
        return [dict(row) for row in cursor.fetchall()]

    # ==================== Knowledge Base ====================

    def learn_from_success(self, pattern_type: str, pattern_name: str,
                           prompt_fragment: str, settings: dict = None,
                           quality_score: float = None):
        """Record a successful pattern."""
        cursor = self.conn.cursor()

        # Check if pattern exists
        cursor.execute("""
            SELECT id, effective_prompts, success_count, avg_quality_score
            FROM learned_patterns
            WHERE pattern_type = ? AND pattern_name = ?
        """, (pattern_type, pattern_name))
        row = cursor.fetchone()

        if row:
            # Update existing pattern
            existing_prompts = json.loads(row["effective_prompts"] or "[]")
            if prompt_fragment not in existing_prompts:
                existing_prompts.append(prompt_fragment)

            new_count = row["success_count"] + 1
            if quality_score and row["avg_quality_score"]:
                new_avg = (row["avg_quality_score"] * row["success_count"] + quality_score) / new_count
            else:
                new_avg = quality_score

            cursor.execute("""
                UPDATE learned_patterns SET
                    effective_prompts = ?,
                    success_count = ?,
                    avg_quality_score = ?,
                    updated_at = ?
                WHERE id = ?
            """, (
                json.dumps(existing_prompts),
                new_count,
                new_avg,
                datetime.now().isoformat(),
                row["id"]
            ))
        else:
            # Create new pattern
            cursor.execute("""
                INSERT INTO learned_patterns (
                    pattern_type, pattern_name, effective_prompts,
                    effective_settings, success_count, avg_quality_score
                ) VALUES (?, ?, ?, ?, 1, ?)
            """, (
                pattern_type,
                pattern_name,
                json.dumps([prompt_fragment]),
                json.dumps(settings) if settings else None,
                quality_score
            ))

        self.conn.commit()

    def learn_from_failure(self, pattern_type: str, pattern_name: str,
                           prompt_fragment: str):
        """Record a failed pattern."""
        cursor = self.conn.cursor()

        cursor.execute("""
            SELECT id, avoid_prompts, failure_count
            FROM learned_patterns
            WHERE pattern_type = ? AND pattern_name = ?
        """, (pattern_type, pattern_name))
        row = cursor.fetchone()

        if row:
            avoid_prompts = json.loads(row["avoid_prompts"] or "[]")
            if prompt_fragment not in avoid_prompts:
                avoid_prompts.append(prompt_fragment)

            cursor.execute("""
                UPDATE learned_patterns SET
                    avoid_prompts = ?,
                    failure_count = ?,
                    updated_at = ?
                WHERE id = ?
            """, (
                json.dumps(avoid_prompts),
                row["failure_count"] + 1,
                datetime.now().isoformat(),
                row["id"]
            ))
        else:
            cursor.execute("""
                INSERT INTO learned_patterns (
                    pattern_type, pattern_name, avoid_prompts, failure_count
                ) VALUES (?, ?, ?, 1)
            """, (
                pattern_type,
                pattern_name,
                json.dumps([prompt_fragment])
            ))

        self.conn.commit()

    def get_effective_patterns(self, pattern_type: str, limit: int = 10) -> list[dict]:
        """Get patterns sorted by success rate."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM learned_patterns
            WHERE pattern_type = ? AND success_count > 0
            ORDER BY
                CASE WHEN failure_count = 0 THEN 1 ELSE 0 END DESC,
                (success_count * 1.0 / (success_count + failure_count)) DESC,
                avg_quality_score DESC
            LIMIT ?
        """, (pattern_type, limit))
        patterns = []
        for row in cursor.fetchall():
            p = dict(row)
            for field in ["effective_prompts", "avoid_prompts", "effective_settings"]:
                if p.get(field):
                    with contextlib.suppress(json.JSONDecodeError):
                        p[field] = json.loads(p[field])
            patterns.append(p)
        return patterns

    def get_avoid_patterns(self, pattern_type: str) -> list[str]:
        """Get list of prompt fragments to avoid."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT avoid_prompts FROM learned_patterns
            WHERE pattern_type = ? AND avoid_prompts IS NOT NULL
        """, (pattern_type,))

        avoid_list = []
        for row in cursor.fetchall():
            if row["avoid_prompts"]:
                avoid_list.extend(json.loads(row["avoid_prompts"]))
        return list(set(avoid_list))

    # ==================== Screenplay Management (v2.37) ====================

    VALID_SCREENPLAY_PHASES = ["concept", "screenplay", "breakdown", "characters", "complete"]

    def save_screenplay(self, project_id: int, concept: str, genre: str = None,
                        target_duration: float = None, scene_count: int = None,
                        outline_json: str = None, screenplay_json: str = None,
                        current_phase: str = "concept") -> int:
        """Create a screenplay and return its ID."""
        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT INTO screenplays (
                project_id, concept, genre, target_duration, scene_count,
                outline_json, screenplay_json, current_phase
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            project_id, concept, genre, target_duration, scene_count,
            outline_json, screenplay_json, current_phase
        ))
        self.conn.commit()
        return cursor.lastrowid

    def get_screenplay(self, project_id: int) -> dict | None:
        """Get the latest screenplay for a project."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM screenplays
            WHERE project_id = ?
            ORDER BY created_at DESC LIMIT 1
        """, (project_id,))
        row = cursor.fetchone()
        if row:
            result = dict(row)
            for field in ["outline_json", "screenplay_json"]:
                if result.get(field):
                    with contextlib.suppress(json.JSONDecodeError):
                        result[field] = json.loads(result[field])
            return result
        return None

    def get_screenplay_by_id(self, screenplay_id: int) -> dict | None:
        """Get a screenplay by its ID."""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM screenplays WHERE id = ?", (screenplay_id,))
        row = cursor.fetchone()
        if row:
            result = dict(row)
            for field in ["outline_json", "screenplay_json"]:
                if result.get(field):
                    with contextlib.suppress(json.JSONDecodeError):
                        result[field] = json.loads(result[field])
            return result
        return None

    def update_screenplay(self, screenplay_id: int, **fields):
        """Update screenplay fields."""
        cursor = self.conn.cursor()
        allowed = {"concept", "genre", "target_duration", "scene_count",
                   "outline_json", "screenplay_json", "current_phase"}
        updates = []
        values = []
        for key, val in fields.items():
            if key not in allowed:
                continue
            if key == "current_phase" and val not in self.VALID_SCREENPLAY_PHASES:
                raise ValueError(f"Invalid screenplay phase: {val}")
            updates.append(f"{key} = ?")
            if isinstance(val, (dict, list)):
                val = json.dumps(val)
            values.append(val)
        if updates:
            updates.append("updated_at = CURRENT_TIMESTAMP")
            values.append(screenplay_id)
            cursor.execute(f"""
                UPDATE screenplays SET {', '.join(updates)} WHERE id = ?
            """, values)
            self.conn.commit()

    # ==================== Film Character Management (v2.37) ====================

    def save_film_character(self, project_id: int, name: str, role: str = "supporting",
                            description: str = None, screenplay_id: int = None,
                            age: int = None, gender: str = None,
                            voice_id: str = None, voice_name: str = None,
                            go_bananas_character_id: int = None,
                            go_bananas_image_url: str = None,
                            character_json: str = None) -> int:
        """Create a film character and return its ID."""
        cursor = self.conn.cursor()
        if isinstance(character_json, (dict, list)):
            character_json = json.dumps(character_json)
        cursor.execute("""
            INSERT INTO film_characters (
                project_id, screenplay_id, name, role, description,
                age, gender, voice_id, voice_name,
                go_bananas_character_id, go_bananas_image_url, character_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            project_id, screenplay_id, name, role, description,
            age, gender, voice_id, voice_name,
            go_bananas_character_id, go_bananas_image_url, character_json
        ))
        self.conn.commit()
        return cursor.lastrowid

    def get_film_characters(self, project_id: int) -> list[dict]:
        """Get all film characters for a project."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM film_characters
            WHERE project_id = ?
            ORDER BY name
        """, (project_id,))
        characters = []
        for row in cursor.fetchall():
            char = dict(row)
            if char.get("character_json"):
                with contextlib.suppress(json.JSONDecodeError):
                    char["character_json"] = json.loads(char["character_json"])
            characters.append(char)
        return characters

    def get_film_character_by_name(self, project_id: int, name: str) -> dict | None:
        """Get a film character by project and name."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM film_characters
            WHERE project_id = ? AND name = ?
            ORDER BY created_at DESC LIMIT 1
        """, (project_id, name))
        row = cursor.fetchone()
        if row:
            char = dict(row)
            if char.get("character_json"):
                with contextlib.suppress(json.JSONDecodeError):
                    char["character_json"] = json.loads(char["character_json"])
            return char
        return None

    def update_film_character(self, character_id: int, **fields):
        """Update film character fields."""
        cursor = self.conn.cursor()
        allowed = {"name", "role", "description", "age", "gender",
                   "voice_id", "voice_name", "go_bananas_character_id",
                   "go_bananas_image_url", "character_json"}
        updates = []
        values = []
        for key, val in fields.items():
            if key not in allowed:
                continue
            updates.append(f"{key} = ?")
            if isinstance(val, (dict, list)):
                val = json.dumps(val)
            values.append(val)
        if updates:
            updates.append("updated_at = CURRENT_TIMESTAMP")
            values.append(character_id)
            cursor.execute(f"""
                UPDATE film_characters SET {', '.join(updates)} WHERE id = ?
            """, values)
            self.conn.commit()

    # ==================== Analytics ====================

    def get_project_stats(self, project_id: int) -> dict:
        """Get generation statistics for a project."""
        cursor = self.conn.cursor()

        # Video stats
        cursor.execute("""
            SELECT
                COUNT(*) as total_videos,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                SUM(credits_used) as total_credits,
                AVG(generation_time_seconds) as avg_gen_time,
                AVG(motion_accuracy_score) as avg_motion_score,
                AVG(prompt_adherence_score) as avg_prompt_score,
                AVG(visual_quality_score) as avg_visual_score
            FROM videos WHERE project_id = ?
        """, (project_id,))
        video_stats = dict(cursor.fetchone())

        # Scene stats
        cursor.execute("""
            SELECT COUNT(*) as total_scenes FROM scenes WHERE project_id = ?
        """, (project_id,))
        scene_stats = dict(cursor.fetchone())

        # Image stats
        cursor.execute("""
            SELECT COUNT(*) as total_images FROM images WHERE project_id = ?
        """, (project_id,))
        image_stats = dict(cursor.fetchone())

        return {
            "videos": video_stats,
            "scenes": scene_stats,
            "images": image_stats
        }

    def get_overall_stats(self) -> dict:
        """Get overall system statistics."""
        cursor = self.conn.cursor()

        cursor.execute("SELECT COUNT(*) as count FROM projects")
        projects = cursor.fetchone()["count"]

        cursor.execute("""
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(credits_used) as credits
            FROM videos
        """)
        videos = dict(cursor.fetchone())

        cursor.execute("""
            SELECT COUNT(*) as count FROM learned_patterns WHERE success_count > 0
        """)
        patterns = cursor.fetchone()["count"]

        return {
            "projects": projects,
            "videos": videos,
            "learned_patterns": patterns
        }

    def get_best_performing_prompts(self, limit: int = 10) -> list[dict]:
        """Get prompts with highest quality scores."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT
                prompt_used,
                mode,
                AVG(motion_accuracy_score) as avg_motion,
                AVG(prompt_adherence_score) as avg_prompt,
                AVG(visual_quality_score) as avg_visual,
                COUNT(*) as usage_count
            FROM videos
            WHERE status = 'completed'
                AND (motion_accuracy_score IS NOT NULL
                     OR prompt_adherence_score IS NOT NULL
                     OR visual_quality_score IS NOT NULL)
            GROUP BY prompt_used
            ORDER BY (COALESCE(avg_motion, 0) + COALESCE(avg_prompt, 0) + COALESCE(avg_visual, 0)) DESC
            LIMIT ?
        """, (limit,))
        return [dict(row) for row in cursor.fetchall()]

    # ==================== Telemetry ====================

    def add_run_telemetry(
        self,
        project_slug: str,
        run_id: str,
        backend: str,
        started_at: str,
        completed_at: str,
        total_scenes: int,
        success_count: int,
        failed_count: int,
        total_credits: int,
        total_duration_s: float,
        jsonl_path: str,
    ) -> None:
        """Insert or replace a run-level telemetry summary."""
        try:
            self.conn.execute(
                """
                INSERT OR REPLACE INTO run_telemetry
                    (project_slug, run_id, backend, started_at, completed_at,
                     total_scenes, success_count, failed_count,
                     total_credits, total_duration_s, jsonl_path)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (project_slug, run_id, backend, started_at, completed_at,
                 total_scenes, success_count, failed_count,
                 total_credits, total_duration_s, jsonl_path),
            )
            self.conn.commit()
        except Exception:
            pass

    def update_video_telemetry(
        self,
        video_id: int,
        retry_count: int,
        quality_fallback: bool,
        content_violations: int,
        upload_service: str,
        failure_reason: str,
    ) -> None:
        """Update telemetry columns on an existing videos row."""
        try:
            self.conn.execute(
                """
                UPDATE videos
                SET retry_count=?, quality_fallback=?, content_violations=?,
                    upload_service=?, failure_reason=?
                WHERE id=?
                """,
                (retry_count, int(quality_fallback), content_violations,
                 upload_service, failure_reason, video_id),
            )
            self.conn.commit()
        except Exception:
            pass


# CLI interface for direct usage
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Video Replicator Database Manager")
    parser.add_argument("command", choices=["init", "status", "stats", "projects", "best-prompts"])
    parser.add_argument("--project", help="Project slug")
    parser.add_argument("--limit", type=int, default=10, help="Limit results")
    args = parser.parse_args()

    db = VideoReplicatorDB()

    if args.command == "init":
        print(f"Database initialized at: {db.db_path}")
        print("Tables created successfully.")

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
        print("\n=== Video Replicator Stats ===")
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
            print(f"   {p['prompt_used'][:80]}...")

    db.close()
