"""
Training pipeline for the OP/ED detection CNN.

Auto-labeled data comes from cross-episode comparison (Phase 2).
The CNN learns to classify 10-second spectrogram windows as opening/ending/content.
"""

import random
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from pathlib import Path
from .model import SkipSegmentCNN
from .features import audio_to_mel_spectrogram, spectrogram_to_windows

MODELS_DIR = Path("/app/ml_data/models")
TRAINING_DATA_DIR = Path("/app/ml_data/features")
LABEL_MAP = {"opening": 0, "ending": 1, "content": 2}
MIN_SAMPLES_TO_TRAIN = 50  # minimum total samples before training makes sense


class SpectrogramDataset(Dataset):
    """Dataset of labeled spectrogram windows."""

    def __init__(self, samples: list[tuple[np.ndarray, int]]):
        self.samples = samples

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        spec, label = self.samples[idx]
        # Add channel dimension: (128, W) -> (1, 128, W)
        tensor = torch.FloatTensor(spec).unsqueeze(0)
        # Normalize: spectrogram is in dB (typically -80 to 0), scale to ~[-1, 1]
        tensor = (tensor + 40) / 40
        return tensor, label


def build_training_samples(
    audio_path: Path,
    segment_start: float,
    segment_end: float,
    label: str,
    audio_duration: float = 180.0,
) -> list[tuple[np.ndarray, int]]:
    """
    Create training samples from a labeled audio file.

    For OP/ED segments: all windows within the segment get the OP/ED label.
    Also generates 'content' samples from regions outside the segment.
    """
    if not audio_path or not audio_path.exists():
        return []

    S_db = audio_to_mel_spectrogram(audio_path)
    all_windows = spectrogram_to_windows(S_db)

    samples = []
    label_id = LABEL_MAP[label]

    for window, start_sec in all_windows:
        end_sec = start_sec + 10  # window is 10s
        # Check if this window is inside the labeled segment
        overlap = min(end_sec, segment_end) - max(start_sec, segment_start)
        if overlap >= 5:  # at least 5s overlap -> belongs to the segment
            samples.append((window, label_id))
        elif start_sec >= segment_end or end_sec <= segment_start:
            # Fully outside -> content
            samples.append((window, LABEL_MAP["content"]))

    return samples


def save_training_data(samples: list[tuple[np.ndarray, int]], anime_id: str):
    """Save training samples to disk for incremental training."""
    TRAINING_DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = TRAINING_DATA_DIR / f"{anime_id}.npz"

    specs = np.array([s[0] for s in samples])
    labels = np.array([s[1] for s in samples])
    np.savez_compressed(str(path), specs=specs, labels=labels)
    print(f"[ml] Saved {len(samples)} training samples for '{anime_id}'")


def load_all_training_data() -> list[tuple[np.ndarray, int]]:
    """Load all saved training data from disk."""
    samples = []
    if not TRAINING_DATA_DIR.exists():
        return samples

    for npz_file in TRAINING_DATA_DIR.glob("*.npz"):
        data = np.load(str(npz_file))
        specs = data["specs"]
        labels = data["labels"]
        for i in range(len(labels)):
            samples.append((specs[i], int(labels[i])))

    return samples


_training_in_progress = False
MAX_TRAINING_SAMPLES = 3000  # cap to keep CPU training manageable


def train_model(epochs: int = 10, batch_size: int = 32, lr: float = 1e-3) -> SkipSegmentCNN | None:
    """
    Train the CNN on all accumulated auto-labeled data.
    Returns trained model, or None if not enough data.
    """
    global _training_in_progress
    if _training_in_progress:
        print("[ml] Training already in progress, skipping")
        return None
    _training_in_progress = True

    try:
        return _do_train(epochs, batch_size, lr)
    finally:
        _training_in_progress = False


def _do_train(epochs: int, batch_size: int, lr: float) -> SkipSegmentCNN | None:
    samples = load_all_training_data()

    if len(samples) < MIN_SAMPLES_TO_TRAIN:
        print(f"[ml] Not enough training data ({len(samples)}/{MIN_SAMPLES_TO_TRAIN})")
        return None

    # Balance classes: downsample content to match OP+ED count
    by_class = {0: [], 1: [], 2: []}
    for s in samples:
        by_class[s[1]].append(s)

    op_count = len(by_class[0])
    ed_count = len(by_class[1])
    target_content = op_count + ed_count
    content_samples = by_class[2]
    if len(content_samples) > target_content:
        content_samples = random.sample(content_samples, target_content)

    balanced = by_class[0] + by_class[1] + content_samples
    random.shuffle(balanced)

    # Cap total samples to keep CPU training fast
    if len(balanced) > MAX_TRAINING_SAMPLES:
        balanced = random.sample(balanced, MAX_TRAINING_SAMPLES)

    print(f"[ml] Training on {len(balanced)} samples "
          f"(OP: {op_count}, ED: {ed_count}, content: {len(content_samples)})")

    dataset = SpectrogramDataset(balanced)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True)

    model = SkipSegmentCNN(num_classes=3)

    # Resume from existing model if available
    model_path = MODELS_DIR / "skip_segment_cnn.pt"
    if model_path.exists():
        try:
            model.load_state_dict(torch.load(model_path, map_location="cpu", weights_only=True))
            print("[ml] Loaded existing model weights for fine-tuning")
        except Exception:
            print("[ml] Could not load existing model, training from scratch")

    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    criterion = nn.CrossEntropyLoss(
        weight=torch.FloatTensor([2.0, 2.0, 1.0])  # upweight OP/ED
    )
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=5, factor=0.5)

    model.train()
    for epoch in range(epochs):
        total_loss = 0
        correct = 0
        total = 0

        for batch_x, batch_y in loader:
            optimizer.zero_grad()
            outputs = model(batch_x)
            loss = criterion(outputs, batch_y)
            loss.backward()
            optimizer.step()

            total_loss += loss.item()
            _, predicted = outputs.max(1)
            correct += predicted.eq(batch_y).sum().item()
            total += batch_y.size(0)

        acc = correct / total if total > 0 else 0
        avg_loss = total_loss / len(loader) if len(loader) > 0 else 0
        scheduler.step(avg_loss)

        if (epoch + 1) % 10 == 0:
            print(f"[ml] Epoch {epoch + 1}/{epochs} - Loss: {avg_loss:.4f} - Acc: {acc:.2%}")

    # Save model
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), model_path)
    print(f"[ml] Model saved ({model_path})")

    return model
