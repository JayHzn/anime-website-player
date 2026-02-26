"""
Audio feature extraction for OP/ED detection.

Mel spectrograms for CNN input, music detection for per-episode analysis.
"""

import numpy as np
import librosa
from pathlib import Path

SAMPLE_RATE = 22050
N_FFT = 2048
HOP_LENGTH = 512
N_MELS = 128
WINDOW_SEC = 10        # each spectrogram window covers 10 seconds
WINDOW_STRIDE_SEC = 5  # slide by 5 seconds (50% overlap)

# Music detection parameters
MUSIC_WINDOW_SEC = 5       # analysis window for music detection
MUSIC_HOP_SEC = 2.5        # hop between windows (50% overlap)
MIN_MUSIC_DURATION_SEC = 30  # minimum segment to be considered OP/ED
MAX_MUSIC_DURATION_SEC = 120  # maximum (typical OP/ED is 60-90s)
MUSIC_GAP_TOLERANCE_SEC = 5   # merge segments within 5s of each other


def audio_to_mel_spectrogram(audio_path: Path) -> np.ndarray:
    """
    Load audio and compute full mel spectrogram.
    Returns: (n_mels, n_frames) array in dB scale.
    """
    y, sr = librosa.load(str(audio_path), sr=SAMPLE_RATE, mono=True)
    S = librosa.feature.melspectrogram(
        y=y, sr=sr, n_fft=N_FFT, hop_length=HOP_LENGTH, n_mels=N_MELS
    )
    S_db = librosa.power_to_db(S, ref=np.max)
    return S_db


def spectrogram_to_windows(S_db: np.ndarray) -> list[tuple[np.ndarray, float]]:
    """
    Slice a full spectrogram into fixed-size windows.
    Each window: (n_mels=128, ~431 time frames) for 10s at ~43 fps.
    Returns list of (spectrogram_window, start_time_sec) tuples.
    """
    frames_per_window = int(WINDOW_SEC * SAMPLE_RATE / HOP_LENGTH)
    frames_per_stride = int(WINDOW_STRIDE_SEC * SAMPLE_RATE / HOP_LENGTH)

    windows = []
    total_frames = S_db.shape[1]

    start = 0
    while start + frames_per_window <= total_frames:
        window = S_db[:, start:start + frames_per_window]
        start_sec = start * HOP_LENGTH / SAMPLE_RATE
        windows.append((window, start_sec))
        start += frames_per_stride

    return windows


def detect_music_segments(audio_path: Path, time_offset: float = 0) -> list[dict]:
    """
    Detect music segments in an audio file using spectral features.

    Music vs speech/effects discrimination:
    - Spectral flatness: music is tonal (low), speech is noisy (high)
    - RMS energy stability: music has consistent energy, speech varies
    - Spectral contrast: music has higher contrast between frequency bands
    - Onset regularity: music has periodic beats

    Args:
        audio_path: path to WAV file
        time_offset: absolute time offset to add to detected positions

    Returns: list of {"start": float, "end": float, "confidence": float}
    """
    y, sr = librosa.load(str(audio_path), sr=SAMPLE_RATE, mono=True)
    duration = len(y) / sr

    window_samples = int(MUSIC_WINDOW_SEC * sr)
    hop_samples = int(MUSIC_HOP_SEC * sr)

    window_scores = []

    for start_sample in range(0, len(y) - window_samples + 1, hop_samples):
        window = y[start_sample:start_sample + window_samples]
        start_sec = start_sample / sr

        score = _compute_music_score(window, sr)
        window_scores.append({
            "start": start_sec,
            "end": start_sec + MUSIC_WINDOW_SEC,
            "score": score,
        })

    if not window_scores:
        return []

    # Adaptive threshold: use the distribution of scores
    scores = np.array([w["score"] for w in window_scores])
    threshold = float(np.percentile(scores, 60))  # top 40% of windows
    threshold = max(threshold, 0.35)  # absolute minimum

    # Find contiguous music regions above threshold
    music_windows = [w for w in window_scores if w["score"] >= threshold]
    segments = _merge_windows(music_windows)

    # Filter by duration (OP/ED is typically 30-120s)
    valid_segments = []
    for seg in segments:
        seg_duration = seg["end"] - seg["start"]
        if MIN_MUSIC_DURATION_SEC <= seg_duration <= MAX_MUSIC_DURATION_SEC:
            # Confidence = average score of windows in this segment
            seg_scores = [
                w["score"] for w in window_scores
                if w["start"] >= seg["start"] and w["end"] <= seg["end"]
            ]
            confidence = float(np.mean(seg_scores)) if seg_scores else 0.5

            valid_segments.append({
                "start": round(seg["start"] + time_offset, 1),
                "end": round(seg["end"] + time_offset, 1),
                "confidence": round(min(confidence / 0.8, 1.0), 3),  # normalize to 0-1
            })

    # Sort by confidence (best first)
    valid_segments.sort(key=lambda s: s["confidence"], reverse=True)
    return valid_segments


def _compute_music_score(window: np.ndarray, sr: int) -> float:
    """
    Compute a 0-1 music likelihood score for a short audio window.

    Combines multiple features that distinguish music from speech/effects:
    - Low spectral flatness → tonal content (music)
    - High spectral contrast → clear harmonic structure
    - Steady RMS energy → consistent dynamics
    - Regular onset pattern → rhythmic structure
    """
    # Spectral flatness: 0=tonal (music), 1=noisy (speech)
    flatness = float(np.mean(librosa.feature.spectral_flatness(y=window)))
    flatness_score = 1.0 - min(flatness / 0.1, 1.0)  # lower = more musical

    # RMS energy stability (coefficient of variation)
    rms = librosa.feature.rms(y=window, frame_length=2048, hop_length=512)[0]
    if np.mean(rms) > 0.001:  # not silence
        cv = float(np.std(rms) / (np.mean(rms) + 1e-8))
        energy_score = 1.0 - min(cv / 1.5, 1.0)  # lower variation = more musical
    else:
        return 0.0  # silence, not music

    # Spectral contrast (mean across bands)
    contrast = librosa.feature.spectral_contrast(y=window, sr=sr, n_fft=2048, hop_length=512)
    contrast_score = min(float(np.mean(contrast)) / 30.0, 1.0)  # normalize

    # Onset strength regularity (autocorrelation of onset envelope)
    onset_env = librosa.onset.onset_strength(y=window, sr=sr, hop_length=512)
    if len(onset_env) > 10:
        autocorr = np.correlate(onset_env - np.mean(onset_env), onset_env - np.mean(onset_env), mode="full")
        autocorr = autocorr[len(autocorr) // 2:]  # positive lags only
        if autocorr[0] > 0:
            autocorr = autocorr / autocorr[0]
            # Find strongest periodicity (ignoring lag 0)
            if len(autocorr) > 5:
                rhythm_score = float(np.max(autocorr[3:]))  # skip first few lags
            else:
                rhythm_score = 0.3
        else:
            rhythm_score = 0.3
    else:
        rhythm_score = 0.3

    # Weighted combination
    score = (
        0.30 * flatness_score +
        0.25 * energy_score +
        0.25 * contrast_score +
        0.20 * rhythm_score
    )

    return float(score)


def _merge_windows(windows: list[dict]) -> list[dict]:
    """Merge overlapping or close music windows into contiguous segments."""
    if not windows:
        return []

    # Sort by start time
    sorted_windows = sorted(windows, key=lambda w: w["start"])

    segments = []
    current_start = sorted_windows[0]["start"]
    current_end = sorted_windows[0]["end"]

    for w in sorted_windows[1:]:
        if w["start"] <= current_end + MUSIC_GAP_TOLERANCE_SEC:
            # Extend current segment
            current_end = max(current_end, w["end"])
        else:
            # Save current segment, start new one
            segments.append({"start": current_start, "end": current_end})
            current_start = w["start"]
            current_end = w["end"]

    segments.append({"start": current_start, "end": current_end})
    return segments


def frames_to_sec(n_frames: int) -> float:
    return n_frames * HOP_LENGTH / SAMPLE_RATE


def sec_to_frames(sec: float) -> int:
    return int(sec * SAMPLE_RATE / HOP_LENGTH)
