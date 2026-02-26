"""
Audio extraction from video URLs using ffmpeg.

Extracts the first and last 5 minutes of each episode for OP/ED analysis.
Audio is converted to mono WAV at 22050 Hz (standard for music analysis).
"""

import asyncio
import hashlib
from pathlib import Path

AUDIO_CACHE_DIR = Path("/app/ml_data/audio")
SAMPLE_RATE = 22050
HEAD_DURATION = 300  # 5 minutes for opening detection
TAIL_DURATION = 300  # 5 minutes for ending detection


def _url_hash(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:16]


async def extract_audio_segment(
    video_url: str,
    referer: str | None = None,
    start_sec: float = 0,
    duration_sec: float = 300,
) -> Path | None:
    """
    Extract audio from a video URL using ffmpeg.
    Returns path to .wav file, or None on failure.
    """
    cache_key = f"{_url_hash(video_url)}_{int(start_sec)}_{int(duration_sec)}"
    output_path = AUDIO_CACHE_DIR / f"{cache_key}.wav"

    if output_path.exists() and output_path.stat().st_size > 0:
        return output_path

    AUDIO_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # Use -referer and -user_agent (protocol-level options) so headers
    # are sent on ALL HTTP requests including HLS segment fetches.
    # -headers only applies to the initial request and CDNs return 403
    # on segment downloads without proper Referer.
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"

    cmd = ["ffmpeg", "-y", "-user_agent", ua]
    if referer:
        cmd += ["-referer", referer]

    cmd += [
        "-i", video_url,
        "-ss", str(start_sec),      # -ss after -i: slower but reliable for HLS
        "-t", str(duration_sec),
        "-vn",                      # no video
        "-ac", "1",                 # mono
        "-ar", str(SAMPLE_RATE),    # 22050 Hz
        "-f", "wav",
        str(output_path),
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=180)

        if proc.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0:
            print(f"[ml] Extracted audio: {output_path.name}")
            return output_path

        print(f"[ml] ffmpeg error (code {proc.returncode}): {stderr.decode()[-300:]}")
        output_path.unlink(missing_ok=True)
        return None

    except asyncio.TimeoutError:
        print("[ml] ffmpeg timeout (180s)")
        output_path.unlink(missing_ok=True)
        return None
    except Exception as e:
        print(f"[ml] ffmpeg exception: {e}")
        output_path.unlink(missing_ok=True)
        return None


async def extract_episode_audio(
    video_url: str,
    referer: str | None = None,
    episode_duration: float | None = None,
) -> dict:
    """
    Extract the opening region (first 5min) and ending region (last 5min).
    Returns {"head": Path | None, "tail": Path | None, "tail_offset": float}.
    tail_offset = absolute second where the tail audio starts in the episode.
    """
    head = await extract_audio_segment(
        video_url, referer, start_sec=0, duration_sec=HEAD_DURATION
    )

    tail = None
    tail_offset = 0.0
    if episode_duration and episode_duration > HEAD_DURATION + TAIL_DURATION:
        tail_offset = episode_duration - TAIL_DURATION
        tail = await extract_audio_segment(
            video_url, referer, start_sec=tail_offset, duration_sec=TAIL_DURATION
        )

    return {"head": head, "tail": tail, "tail_offset": tail_offset}


async def get_video_duration(video_url: str, referer: str | None = None) -> float | None:
    """Get video duration in seconds using ffprobe."""
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"

    cmd = ["ffprobe", "-v", "error", "-user_agent", ua]
    if referer:
        cmd += ["-referer", referer]
    cmd += [
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        video_url,
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
        if proc.returncode == 0 and stdout.strip():
            return float(stdout.strip())
    except Exception:
        pass
    return None
