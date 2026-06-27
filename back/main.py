"""
Shinani - Local Anime Streaming Aggregator
FastAPI Backend

All scraping AND video streaming is handled client-side (browser extension or mobile
app) — the backend never fetches or relays any video stream from a streaming host.
The backend only provides: progress tracking and OP/ED skip-segment storage.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import asyncio
import os

from db.database import Database

# Keep references to background tasks to prevent garbage collection
_background_tasks: set[asyncio.Task] = set()

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class CacheControlMiddleware(BaseHTTPMiddleware):
    """Add Cache-Control headers for stable GET endpoints."""

    CACHE_RULES = {
        "/progress": 0,      # never cache progress
    }

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.method == "GET" and response.status_code == 200:
            path = request.url.path
            for prefix, max_age in self.CACHE_RULES.items():
                if path.startswith(prefix) or path == prefix:
                    if max_age > 0:
                        response.headers["Cache-Control"] = f"public, max-age={max_age}"
                    else:
                        response.headers["Cache-Control"] = "no-store"
                    break
        return response


app = FastAPI(title="Shinani API", version="0.2.0")

app.add_middleware(CacheControlMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database
db = Database()


# --- Pydantic Models ---
class ProgressUpdate(BaseModel):
    anime_id: str
    anime_title: str
    anime_cover: Optional[str] = None
    source: str
    episode_number: int
    episode_id: Optional[str] = None  # the source-specific episode slug/path
    total_episodes: Optional[int] = None
    timestamp: float = 0  # position in seconds within the episode


class SkipSegmentCorrection(BaseModel):
    """Manual correction of OP/ED timestamps."""
    segment_type: str  # "opening" or "ending"
    start: float       # start time in seconds
    end: float         # end time in seconds


# --- API Routes ---

@app.get("/")
def root():
    # In production, serve the frontend; otherwise return API status
    static_index = os.path.join(os.path.dirname(__file__), "static", "index.html")
    if os.path.isfile(static_index):
        from fastapi.responses import FileResponse
        return FileResponse(static_index)
    return {"status": "ok"}


# --- Progress Tracking ---

def _get_user_id(request: Request) -> str:
    """Extract user ID from X-User-Id header, fallback to 'default'."""
    return request.headers.get("x-user-id", "default")[:64]


@app.get("/progress")
def get_all_progress(request: Request):
    """Get all anime progress (continue watching)."""
    return db.get_all_progress(_get_user_id(request))


@app.get("/progress/{anime_id}")
def get_progress(anime_id: str, request: Request):
    """Get progress for a specific anime."""
    p = db.get_progress(anime_id, _get_user_id(request))
    if not p:
        raise HTTPException(404, "No progress found")
    return p


@app.post("/progress")
def update_progress(data: ProgressUpdate, request: Request):
    """Update watch progress."""
    db.update_progress(
        anime_id=data.anime_id,
        anime_title=data.anime_title,
        anime_cover=data.anime_cover,
        source=data.source,
        episode_number=data.episode_number,
        episode_id=data.episode_id,
        total_episodes=data.total_episodes,
        timestamp=data.timestamp,
        user_id=_get_user_id(request),
    )
    return {"status": "ok"}


@app.delete("/progress/{anime_id}")
def delete_progress(anime_id: str, request: Request):
    """Delete progress for an anime."""
    db.delete_progress(anime_id, _get_user_id(request))
    return {"status": "ok"}


# --- Skip Segments (OP/ED Detection) ---

@app.get("/episode/{source}/{episode_id:path}/skip-segments")
async def get_skip_segments(source: str, episode_id: str, ep: Optional[int] = None):
    """Get OP/ED skip segment timestamps for an episode."""
    anime_id = episode_id.split("/")[0] if "/" in episode_id else episode_id
    episode_number = ep or 0

    cached = db.get_skip_segments(anime_id, source, episode_number)
    if cached:
        return {**cached, "status": "ready"}
    return {"opening": None, "ending": None, "status": "unavailable"}


@app.put("/anime/{source}/{anime_id:path}/skip-segments/{episode_number}")
def correct_skip_segment(source: str, anime_id: str, episode_number: int, data: SkipSegmentCorrection):
    """Manually correct OP/ED timestamps for an episode."""
    if data.segment_type not in ("opening", "ending"):
        raise HTTPException(400, "segment_type must be 'opening' or 'ending'")
    if data.end <= data.start:
        raise HTTPException(400, "end must be greater than start")

    db.save_skip_segment(
        anime_id=anime_id,
        source=source,
        episode_number=episode_number,
        segment_type=data.segment_type,
        start_time=data.start,
        end_time=data.end,
        confidence=1.0,
        detection_method="manual",
    )
    return {"status": "ok"}


@app.delete("/anime/{source}/{anime_id:path}/skip-segments/{episode_number}")
def delete_skip_segments(source: str, anime_id: str, episode_number: int):
    """Delete all skip segments for an episode (if detection was wrong)."""
    db.delete_skip_segments(anime_id, source, episode_number)
    return {"status": "ok"}


# --- Static Frontend (production) ---
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(STATIC_DIR):
    from fastapi.responses import FileResponse

    @app.get("/assets/{file_path:path}")
    async def static_assets(file_path: str):
        """Serve Vite build assets."""
        full = os.path.join(STATIC_DIR, "assets", file_path)
        if os.path.isfile(full):
            return FileResponse(full)
        raise HTTPException(404)

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        """SPA fallback: serve index.html for all non-API routes."""
        # Don't catch API routes
        if full_path.startswith(("api/", "episode/", "progress", "ml/")):
            raise HTTPException(404)
        # Serve actual static files if they exist
        file_path = os.path.join(STATIC_DIR, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        # Otherwise serve index.html (SPA routing)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
