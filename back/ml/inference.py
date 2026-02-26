"""
CNN inference service for single-episode OP/ED detection.

Once the model is trained on enough auto-labeled data, it can predict
OP/ED segments from a single episode without needing cross-episode comparison.
"""

import torch
import numpy as np
from pathlib import Path
from .model import SkipSegmentCNN
from .features import audio_to_mel_spectrogram, spectrogram_to_windows, WINDOW_STRIDE_SEC, WINDOW_SEC

MODELS_DIR = Path("/app/ml_data/models")
CONFIDENCE_THRESHOLD = 0.7
MIN_CONSECUTIVE_WINDOWS = 3  # at least 3 windows (15+ seconds) to confirm a segment


class SkipSegmentDetector:
    """Singleton inference service for OP/ED detection."""

    def __init__(self):
        self._model: SkipSegmentCNN | None = None
        self._loaded = False

    def _load_model(self):
        model_path = MODELS_DIR / "skip_segment_cnn.pt"
        if not model_path.exists():
            self._model = None
            self._loaded = True
            return

        try:
            self._model = SkipSegmentCNN(num_classes=3)
            self._model.load_state_dict(
                torch.load(model_path, map_location="cpu", weights_only=True)
            )
            self._model.eval()
            self._loaded = True
            print("[ml] CNN model loaded for inference")
        except Exception as e:
            print(f"[ml] Failed to load CNN model: {e}")
            self._model = None
            self._loaded = True

    @property
    def is_available(self) -> bool:
        if not self._loaded:
            self._load_model()
        return self._model is not None

    def reload(self):
        """Force reload model (after retraining)."""
        self._loaded = False

    def detect(
        self,
        head_audio_path: Path | None,
        tail_audio_path: Path | None = None,
        tail_offset_sec: float = 0,
    ) -> dict:
        """
        Run CNN inference on episode audio.

        Args:
            head_audio_path: path to first 3min audio (for OP detection)
            tail_audio_path: path to last 3min audio (for ED detection)
            tail_offset_sec: absolute time where tail audio starts in the episode

        Returns: {
            "opening": {"start", "end", "confidence"} | None,
            "ending": {"start", "end", "confidence"} | None,
        }
        """
        if not self.is_available:
            return {"opening": None, "ending": None}

        result = {"opening": None, "ending": None}

        if head_audio_path and head_audio_path.exists():
            op = self._detect_segment(head_audio_path, target_class=0, time_offset=0)
            if op:
                result["opening"] = op

        if tail_audio_path and tail_audio_path.exists():
            ed = self._detect_segment(tail_audio_path, target_class=1, time_offset=tail_offset_sec)
            if ed:
                result["ending"] = ed

        return result

    def _detect_segment(
        self,
        audio_path: Path,
        target_class: int,
        time_offset: float = 0,
    ) -> dict | None:
        """Classify windows and find contiguous region of target class."""
        S_db = audio_to_mel_spectrogram(audio_path)
        windows = spectrogram_to_windows(S_db)

        if not windows:
            return None

        # Classify all windows
        predictions = []
        with torch.no_grad():
            for window, start_sec in windows:
                tensor = torch.FloatTensor(window).unsqueeze(0).unsqueeze(0)
                tensor = (tensor + 40) / 40  # same normalization as training
                logits = self._model(tensor)
                probs = torch.softmax(logits, dim=1).squeeze()
                predictions.append({
                    "class": probs.argmax().item(),
                    "target_prob": probs[target_class].item(),
                    "start_sec": start_sec,
                })

        # Find longest contiguous run of target predictions above threshold
        best_segment = None
        current_start = None
        current_probs = []

        for pred in predictions:
            if pred["class"] == target_class and pred["target_prob"] > CONFIDENCE_THRESHOLD:
                if current_start is None:
                    current_start = pred["start_sec"]
                    current_probs = []
                current_probs.append(pred["target_prob"])
            else:
                if current_start is not None and len(current_probs) >= MIN_CONSECUTIVE_WINDOWS:
                    segment = {
                        "start_sec": current_start,
                        "length": len(current_probs),
                        "avg_conf": sum(current_probs) / len(current_probs),
                    }
                    if best_segment is None or segment["length"] > best_segment["length"]:
                        best_segment = segment
                current_start = None
                current_probs = []

        # Check last run
        if current_start is not None and len(current_probs) >= MIN_CONSECUTIVE_WINDOWS:
            segment = {
                "start_sec": current_start,
                "length": len(current_probs),
                "avg_conf": sum(current_probs) / len(current_probs),
            }
            if best_segment is None or segment["length"] > best_segment["length"]:
                best_segment = segment

        if not best_segment:
            return None

        start = round(best_segment["start_sec"] + time_offset, 1)
        end = round(start + best_segment["length"] * WINDOW_STRIDE_SEC + WINDOW_SEC, 1)

        return {
            "start": start,
            "end": end,
            "confidence": round(best_segment["avg_conf"], 3),
        }


# Singleton instance
detector = SkipSegmentDetector()
