"""
AnimeHub - Local Anime Streaming Aggregator
FastAPI Backend
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import asyncio
import importlib
import pkgutil
import os

from db.database import Database
from sources.base import AnimeSource
from cover_fetcher import fetch_covers_batch
import cache

# Keep references to background tasks to prevent garbage collection
_background_tasks: set[asyncio.Task] = set()

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class CacheControlMiddleware(BaseHTTPMiddleware):
    """Add Cache-Control headers for stable GET endpoints."""

    CACHE_RULES = {
        "/anime/": 300,      # 5 min for anime info & episodes
        "/search": 120,      # 2 min for search results
        "/sources": 3600,    # 1 hour for source list
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


app = FastAPI(title="AnimeHub API", version="0.1.0")

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

# --- Source Plugin System ---
loaded_sources: dict[str, AnimeSource] = {}


def load_sources():
    """Dynamically load all source plugins from the sources/ directory."""
    sources_dir = os.path.join(os.path.dirname(__file__), "sources")
    for _, module_name, _ in pkgutil.iter_modules([sources_dir]):
        if module_name == "base":
            continue
        try:
            module = importlib.import_module(f"sources.{module_name}")
            if hasattr(module, "Source"):
                source_instance = module.Source()
                loaded_sources[source_instance.name] = source_instance
                print(f"✓ Loaded source: {source_instance.name}")
        except Exception as e:
            print(f"✗ Failed to load source {module_name}: {e}")


load_sources()


# --- Pydantic Models ---
class ProgressUpdate(BaseModel):
    anime_id: str
    anime_title: str
    anime_cover: Optional[str] = None
    source: str
    episode_number: int
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
    return {"status": "ok", "sources": list(loaded_sources.keys())}


@app.get("/sources")
def list_sources():
    """List all available sources."""
    return [
        {"name": s.name, "language": s.language, "base_url": s.base_url}
        for s in loaded_sources.values()
    ]


@app.get("/search")
async def search(q: str = Query(""), source: Optional[str] = None):
    """Search for anime across sources."""
    cache_key = f"search:{source or 'all'}:{q}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    results = []
    sources_to_search = (
        [loaded_sources[source]] if source and source in loaded_sources
        else loaded_sources.values()
    )
    for src in sources_to_search:
        try:
            src_results = await src.search(q)
            for r in src_results:
                r["source"] = src.name
            results.extend(src_results)
        except Exception as e:
            print(f"Search error on {src.name}: {e}")

    # Enrich results missing covers with Jikan API (MyAnimeList) in batch
    missing = [r for r in results if not r.get("cover")]
    if missing:
        titles = [r.get("title", "") for r in missing]
        covers = await fetch_covers_batch(titles)
        for r in missing:
            cover = covers.get(r.get("title", ""), "")
            if cover:
                r["cover"] = cover

    cache.set(cache_key, results, "search")
    return results


@app.get("/anime/{source}/{anime_id:path}/info")
async def get_anime_info(source: str, anime_id: str):
    """Get anime details (title, cover, type, year)."""
    if source not in loaded_sources:
        raise HTTPException(404, f"Source '{source}' not found")

    cache_key = f"info:{source}:{anime_id}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        info = await loaded_sources[source].get_anime_info(anime_id)
        if not info:
            raise HTTPException(404, "Anime info not available")
        info["source"] = source
        cache.set(cache_key, info, "anime_info")
        return info
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/anime/{source}/{anime_id:path}/episodes")
async def get_episodes(source: str, anime_id: str):
    """Get episode list for an anime. Auto-triggers ML training on 10 random episodes."""
    if source not in loaded_sources:
        raise HTTPException(404, f"Source '{source}' not found")

    cache_key = f"episodes:{source}:{anime_id}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        episodes = await loaded_sources[source].get_episodes(anime_id)
        cache.set(cache_key, episodes, "episodes")

        # Auto-trigger background analysis of 10 random episodes for training
        try:
            from ml.orchestrator import analyze_random_episodes
            task = asyncio.create_task(
                analyze_random_episodes(db, anime_id, source, episodes, loaded_sources[source])
            )
            _background_tasks.add(task)
            task.add_done_callback(_background_tasks.discard)
        except ImportError:
            pass  # ML not available

        return episodes
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/episode/{source}/{episode_id:path}/video")
async def get_video_url(source: str, episode_id: str):
    """Get the video URL(s) for an episode."""
    if source not in loaded_sources:
        raise HTTPException(404, f"Source '{source}' not found")
    try:
        return await loaded_sources[source].get_video_url(episode_id)
    except Exception as e:
        raise HTTPException(500, str(e))


# --- Progress Tracking ---

@app.get("/progress")
def get_all_progress():
    """Get all anime progress (continue watching)."""
    return db.get_all_progress()


@app.get("/progress/{anime_id}")
def get_progress(anime_id: str):
    """Get progress for a specific anime."""
    p = db.get_progress(anime_id)
    if not p:
        raise HTTPException(404, "No progress found")
    return p


@app.post("/progress")
def update_progress(data: ProgressUpdate):
    """Update watch progress."""
    db.update_progress(
        anime_id=data.anime_id,
        anime_title=data.anime_title,
        anime_cover=data.anime_cover,
        source=data.source,
        episode_number=data.episode_number,
        total_episodes=data.total_episodes,
        timestamp=data.timestamp,
    )
    return {"status": "ok"}


@app.delete("/progress/{anime_id}")
def delete_progress(anime_id: str):
    """Delete progress for an anime."""
    db.delete_progress(anime_id)
    return {"status": "ok"}


# --- Skip Segments (OP/ED Detection) ---

@app.get("/episode/{source}/{episode_id:path}/skip-segments")
async def get_skip_segments(source: str, episode_id: str, ep: Optional[int] = None):
    """
    Get OP/ED skip segment timestamps for an episode.
    Auto-triggers background analysis if not cached.
    Pass ?ep=N to avoid re-fetching the episode list.
    """
    if source not in loaded_sources:
        raise HTTPException(404, f"Source '{source}' not found")

    # Parse anime_id from episode_id (e.g. "naruto/naruto-001-vostfr" -> "naruto")
    anime_id = episode_id.split("/")[0] if "/" in episode_id else episode_id

    # Use provided episode number, or look it up from cache/scrape
    episode_number = ep or 0
    if not episode_number:
        # Try cache first to avoid a scrape
        cache_key = f"episodes:{source}:{anime_id}"
        episodes = cache.get(cache_key)
        if not episodes:
            try:
                episodes = await loaded_sources[source].get_episodes(anime_id)
                cache.set(cache_key, episodes, "episodes")
            except Exception:
                episodes = []
        for e in episodes:
            if e["id"] == episode_id:
                episode_number = e["number"]
                break

    try:
        from ml.orchestrator import get_skip_segments as ml_get_skip
        result = await ml_get_skip(
            db, anime_id, source, episode_number,
            episode_id=episode_id,
            source_plugin=loaded_sources[source],
        )
        return result
    except ImportError:
        # ML not available — check DB cache only
        cached = db.get_skip_segments(anime_id, source, episode_number)
        if cached:
            return {**cached, "status": "ready"}
        return {"opening": None, "ending": None, "status": "unavailable"}


@app.post("/anime/{source}/{anime_id:path}/analyze-skip")
async def trigger_skip_analysis(source: str, anime_id: str):
    """Trigger background OP/ED analysis for all episodes of an anime."""
    if source not in loaded_sources:
        raise HTTPException(404, f"Source '{source}' not found")

    try:
        from ml.orchestrator import analyze_episode
    except ImportError:
        return {"status": "error", "message": "ML not available"}

    async def analyze_all():
        try:
            episodes = await loaded_sources[source].get_episodes(anime_id)
            print(f"[ml] Batch analysis: {len(episodes)} episodes for '{anime_id}'")
            for ep in episodes:
                try:
                    cached = db.get_skip_segments(anime_id, source, ep["number"])
                    if cached:
                        continue
                    await analyze_episode(
                        db, anime_id, source, ep["number"], ep["id"], loaded_sources[source]
                    )
                except Exception as e:
                    print(f"[ml] Batch: error on ep {ep['number']}: {e}")
            print(f"[ml] Batch analysis complete for '{anime_id}'")
        except Exception as e:
            print(f"[ml] Batch analysis error: {e}")

    task = asyncio.create_task(analyze_all())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return {"status": "analyzing", "message": "Background analysis started"}


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


@app.post("/ml/retrain")
async def retrain_model():
    """Force retrain the CNN model on all accumulated data."""
    try:
        from ml.training import train_model, load_all_training_data
        from ml.inference import detector
    except ImportError:
        return {"status": "error", "message": "ML not available"}

    samples = load_all_training_data()
    if len(samples) < 20:
        return {"status": "error", "message": f"Not enough training data ({len(samples)} samples, need 20+)"}

    task = asyncio.create_task(asyncio.to_thread(train_model))
    _background_tasks.add(task)
    task.add_done_callback(lambda t: (detector.reload(), _background_tasks.discard(t)))
    return {"status": "training", "message": f"Retraining on {len(samples)} samples"}


@app.get("/ml/status")
def ml_status():
    """Get ML system status."""
    try:
        from ml.inference import detector
        from ml.training import load_all_training_data, MODELS_DIR

        model_exists = (MODELS_DIR / "skip_segment_cnn.pt").exists()
        samples = load_all_training_data()
        class_counts = {"opening": 0, "ending": 0, "content": 0}
        label_names = {0: "opening", 1: "ending", 2: "content"}
        for _, label in samples:
            class_counts[label_names.get(label, "content")] += 1

        return {
            "model_available": detector.is_available,
            "model_file_exists": model_exists,
            "total_training_samples": len(samples),
            "samples_by_class": class_counts,
        }
    except ImportError:
        return {"model_available": False, "ml_installed": False}


# --- Static Frontend (production) ---
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(STATIC_DIR):
    from fastapi.staticfiles import StaticFiles
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
        if full_path.startswith(("api/", "sources", "search", "anime/", "episode/", "progress", "ml/")):
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