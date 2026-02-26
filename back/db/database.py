"""
SQLite database for local progress tracking.
"""

import sqlite3
import os
import time


class Database:
    def __init__(self, db_path: str = None):
        if db_path is None:
            # In Docker, use /app/db/ volume. Locally, use same dir.
            docker_path = "/app/data/animehub.db"
            local_path = os.path.join(os.path.dirname(__file__), "animehub.db")
            db_path = docker_path if os.path.isdir("/app/data") else local_path
        self.db_path = db_path
        self._init_db()

    def _conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS progress (
                    anime_id TEXT PRIMARY KEY,
                    anime_title TEXT NOT NULL,
                    anime_cover TEXT,
                    source TEXT NOT NULL,
                    episode_number INTEGER NOT NULL DEFAULT 1,
                    total_episodes INTEGER,
                    timestamp REAL DEFAULT 0,
                    updated_at REAL NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS skip_segments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    anime_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    episode_number INTEGER NOT NULL,
                    segment_type TEXT NOT NULL,
                    start_time REAL NOT NULL,
                    end_time REAL NOT NULL,
                    confidence REAL DEFAULT 0,
                    detection_method TEXT DEFAULT 'fingerprint',
                    created_at REAL NOT NULL,
                    UNIQUE(anime_id, source, episode_number, segment_type)
                )
            """)
            conn.commit()

    def get_all_progress(self) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM progress ORDER BY updated_at DESC"
            ).fetchall()
            return [dict(r) for r in rows]

    def get_progress(self, anime_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM progress WHERE anime_id = ?", (anime_id,)
            ).fetchone()
            return dict(row) if row else None

    def update_progress(
        self,
        anime_id: str,
        anime_title: str,
        anime_cover: str | None,
        source: str,
        episode_number: int,
        total_episodes: int | None,
        timestamp: float,
    ):
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO progress 
                    (anime_id, anime_title, anime_cover, source, episode_number, total_episodes, timestamp, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(anime_id) DO UPDATE SET
                    episode_number = excluded.episode_number,
                    total_episodes = excluded.total_episodes,
                    timestamp = excluded.timestamp,
                    anime_cover = excluded.anime_cover,
                    updated_at = excluded.updated_at
                """,
                (anime_id, anime_title, anime_cover, source, episode_number, total_episodes, timestamp, time.time()),
            )
            conn.commit()

    def delete_progress(self, anime_id: str):
        with self._conn() as conn:
            conn.execute("DELETE FROM progress WHERE anime_id = ?", (anime_id,))
            conn.commit()

    # --- Skip Segments (OP/ED detection) ---

    def get_skip_segments(self, anime_id: str, source: str, episode_number: int) -> dict | None:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM skip_segments WHERE anime_id = ? AND source = ? AND episode_number = ?",
                (anime_id, source, episode_number),
            ).fetchall()
        if not rows:
            return None
        result = {"opening": None, "ending": None}
        for row in rows:
            r = dict(row)
            result[r["segment_type"]] = {
                "start": r["start_time"],
                "end": r["end_time"],
                "confidence": r["confidence"],
            }
        return result

    def save_skip_segment(
        self,
        anime_id: str,
        source: str,
        episode_number: int,
        segment_type: str,
        start_time: float,
        end_time: float,
        confidence: float,
        detection_method: str = "fingerprint",
    ):
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO skip_segments
                    (anime_id, source, episode_number, segment_type, start_time, end_time, confidence, detection_method, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(anime_id, source, episode_number, segment_type) DO UPDATE SET
                    start_time = excluded.start_time,
                    end_time = excluded.end_time,
                    confidence = excluded.confidence,
                    detection_method = excluded.detection_method,
                    created_at = excluded.created_at
                """,
                (anime_id, source, episode_number, segment_type, start_time, end_time, confidence, detection_method, time.time()),
            )
            conn.commit()

    def delete_skip_segments(self, anime_id: str, source: str, episode_number: int):
        with self._conn() as conn:
            conn.execute(
                "DELETE FROM skip_segments WHERE anime_id = ? AND source = ? AND episode_number = ?",
                (anime_id, source, episode_number),
            )
            conn.commit()