"""
Orchestrator for per-episode OP/ED detection.

New approach: detect music segments in each episode individually.
- Opening = music segment in the first 5 minutes
- Ending = music segment in the last 5 minutes
- Each episode is analyzed independently → more training data
- Analysis is triggered automatically when a user watches an episode
"""

import asyncio
import random
from pathlib import Path

from .audio_extract import extract_episode_audio, get_video_duration
from .features import detect_music_segments
from .inference import detector
from .training import build_training_samples, save_training_data, train_model, load_all_training_data, MIN_SAMPLES_TO_TRAIN

# Track ongoing analyses to avoid duplicate work
_active_analyses: set[str] = set()
_analysis_lock = asyncio.Lock()
_background_tasks: set[asyncio.Task] = set()

# Count processed episodes to know when to retrain CNN
_processed_count = 0
RETRAIN_EVERY = 20  # retrain CNN every N episodes processed


async def get_skip_segments(
    db,
    anime_id: str,
    source: str,
    episode_number: int,
    episode_id: str | None = None,
    source_plugin=None,
) -> dict:
    """
    Get skip segments for an episode.
    If not cached, triggers background analysis automatically.
    Returns: {"opening": {...}|None, "ending": {...}|None, "status": str}
    """
    cached = db.get_skip_segments(anime_id, source, episode_number)
    if cached:
        return {**cached, "status": "ready"}

    # Check if analysis is in progress
    task_key = f"{source}:{episode_id or anime_id}:{episode_number}"
    if task_key in _active_analyses:
        return {"opening": None, "ending": None, "status": "analyzing"}

    # Auto-trigger analysis if we have the necessary info
    if episode_id and source_plugin:
        task = asyncio.create_task(
            _safe_analyze_episode(
                db, anime_id, source, episode_number, episode_id, source_plugin
            )
        )
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
        return {"opening": None, "ending": None, "status": "analyzing"}

    return {"opening": None, "ending": None, "status": "unavailable"}


async def analyze_episode(
    db,
    anime_id: str,
    source: str,
    episode_number: int,
    episode_id: str,
    source_plugin,
) -> dict | None:
    """
    Analyze a single episode for OP/ED detection.

    1. Resolve video URL
    2. Get video duration
    3. Extract first 5min + last 5min audio
    4. Detect music segments in each part
    5. Best music in first 5min → opening, best music in last 5min → ending
    6. Save to DB + generate training data
    """
    global _processed_count

    print(f"[ml] Analyzing ep {episode_number} of '{anime_id}'")

    # 1. Get video URL
    video_data = await source_plugin.get_video_url(episode_id)
    video_url = video_data.get("url", "")
    referer = video_data.get("referer")

    if not video_url or video_data.get("type") == "iframe":
        print(f"[ml] Skipping ep {episode_number}: no direct URL")
        return None

    # 2. Get video duration for tail extraction
    duration = await get_video_duration(video_url, referer)
    if duration:
        print(f"[ml] Episode duration: {duration:.0f}s ({duration/60:.1f}min)")

    # 3. Extract audio
    audio = await extract_episode_audio(video_url, referer, episode_duration=duration)

    if not audio["head"]:
        print(f"[ml] Failed to extract audio for ep {episode_number}")
        return None

    # 4. Detect music segments
    result = {"opening": None, "ending": None}

    # Try CNN inference first (if model is trained)
    if detector.is_available:
        print(f"[ml] Using CNN model for ep {episode_number}")
        cnn_result = detector.detect(
            head_audio_path=audio["head"],
            tail_audio_path=audio.get("tail"),
            tail_offset_sec=audio.get("tail_offset", 0),
        )
        if cnn_result["opening"]:
            result["opening"] = cnn_result["opening"]
            print(f"[ml] CNN Opening: {result['opening']['start']}s - {result['opening']['end']}s "
                  f"(confidence: {result['opening']['confidence']})")
        if cnn_result["ending"]:
            result["ending"] = cnn_result["ending"]
            print(f"[ml] CNN Ending: {result['ending']['start']}s - {result['ending']['end']}s "
                  f"(confidence: {result['ending']['confidence']})")

    # Fallback to spectral analysis if CNN didn't find anything
    if not result["opening"] or not result["ending"]:
        method = "spectral (fallback)" if detector.is_available else "spectral"
        if not result["opening"]:
            head_segments = detect_music_segments(audio["head"], time_offset=0)
            if head_segments:
                result["opening"] = head_segments[0]
                print(f"[ml] {method} Opening: {result['opening']['start']}s - {result['opening']['end']}s "
                      f"(confidence: {result['opening']['confidence']})")

        if not result["ending"] and audio["tail"]:
            tail_segments = detect_music_segments(audio["tail"], time_offset=audio["tail_offset"])
            if tail_segments:
                result["ending"] = tail_segments[0]
                print(f"[ml] {method} Ending: {result['ending']['start']}s - {result['ending']['end']}s "
                      f"(confidence: {result['ending']['confidence']})")

    if not result["opening"] and not result["ending"]:
        print(f"[ml] No OP/ED detected for ep {episode_number}")
        return None

    # 5. Save to database
    if result["opening"]:
        db.save_skip_segment(
            anime_id=anime_id,
            source=source,
            episode_number=episode_number,
            segment_type="opening",
            start_time=result["opening"]["start"],
            end_time=result["opening"]["end"],
            confidence=result["opening"]["confidence"],
            detection_method="music_detection",
        )

    if result["ending"]:
        db.save_skip_segment(
            anime_id=anime_id,
            source=source,
            episode_number=episode_number,
            segment_type="ending",
            start_time=result["ending"]["start"],
            end_time=result["ending"]["end"],
            confidence=result["ending"]["confidence"],
            detection_method="music_detection",
        )

    # 6. Generate training data for CNN
    _generate_training_data(anime_id, episode_number, audio, result)

    # 7. Periodic CNN retraining
    _processed_count += 1
    if _processed_count % RETRAIN_EVERY == 0:
        samples = load_all_training_data()
        if len(samples) >= MIN_SAMPLES_TO_TRAIN:
            print("[ml] Triggering CNN retraining...")
            await asyncio.to_thread(train_model)
            detector.reload()

    print(f"[ml] Analysis complete for ep {episode_number} of '{anime_id}'")
    return result


async def _safe_analyze_episode(
    db, anime_id, source, episode_number, episode_id, source_plugin
):
    """Wrapper that tracks active analyses and handles errors."""
    task_key = f"{source}:{episode_id}:{episode_number}"

    async with _analysis_lock:
        if task_key in _active_analyses:
            return
        _active_analyses.add(task_key)

    try:
        await analyze_episode(db, anime_id, source, episode_number, episode_id, source_plugin)
    except Exception as e:
        print(f"[ml] Analysis error for ep {episode_number} of '{anime_id}': {e}")
    finally:
        async with _analysis_lock:
            _active_analyses.discard(task_key)


async def analyze_random_episodes(
    db,
    anime_id: str,
    source: str,
    episodes: list[dict],
    source_plugin,
    count: int = 10,
):
    """
    Analyze up to `count` random episodes from an anime for training data.
    Skips episodes already cached in the database.
    Triggered when user opens an anime page.
    """
    # Filter out episodes already analyzed
    uncached = [
        ep for ep in episodes
        if not db.get_skip_segments(anime_id, source, ep["number"])
    ]

    if not uncached:
        print(f"[ml] All episodes of '{anime_id}' already analyzed")
        return

    # Pick random episodes (or all if less than count)
    selected = random.sample(uncached, min(count, len(uncached)))
    print(f"[ml] Background training: analyzing {len(selected)} random episodes of '{anime_id}'")

    success = 0
    for i, ep in enumerate(selected):
        task_key = f"{source}:{ep['id']}:{ep['number']}"
        async with _analysis_lock:
            if task_key in _active_analyses:
                continue
            _active_analyses.add(task_key)

        try:
            result = await analyze_episode(db, anime_id, source, ep["number"], ep["id"], source_plugin)
            if result:
                success += 1
        except Exception as e:
            print(f"[ml] Background training: error on ep {ep['number']}: {e}")
        finally:
            async with _analysis_lock:
                _active_analyses.discard(task_key)

        # Delay between episodes to avoid CDN rate-limiting
        if i < len(selected) - 1:
            await asyncio.sleep(5)

    print(f"[ml] Background training complete for '{anime_id}': {success}/{len(selected)} episodes OK")


def _generate_training_data(
    anime_id: str,
    episode_number: int,
    audio: dict,
    detection_result: dict,
):
    """Generate labeled spectrogram samples from detection results."""
    all_samples = []

    # OP samples from head audio
    if detection_result["opening"] and audio.get("head"):
        samples = build_training_samples(
            audio_path=Path(str(audio["head"])),
            segment_start=detection_result["opening"]["start"],
            segment_end=detection_result["opening"]["end"],
            label="opening",
        )
        all_samples.extend(samples)

    # ED samples from tail audio
    if detection_result["ending"] and audio.get("tail"):
        # Adjust to be relative to the tail audio file (not absolute time)
        tail_offset = audio.get("tail_offset", 0)
        samples = build_training_samples(
            audio_path=Path(str(audio["tail"])),
            segment_start=detection_result["ending"]["start"] - tail_offset,
            segment_end=detection_result["ending"]["end"] - tail_offset,
            label="ending",
        )
        all_samples.extend(samples)

    if all_samples:
        save_training_data(all_samples, f"{anime_id}_ep{episode_number}")
