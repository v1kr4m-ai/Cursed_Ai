"""Shared helpers for the speech scripts: read a clips folder, decode audio with ffmpeg, score transcripts."""
import os
import random
import re
import subprocess
import sys
import unicodedata

import numpy as np

AUDIO_EXT = (".wav", ".mp3", ".flac", ".m4a", ".ogg", ".opus", ".webm", ".aac")


def say(msg):
    print(msg, flush=True)


def load_audio(path, sr=16000):
    """Mono float32 samples at `sr`, decoded by ffmpeg (so every common format works and no audio library is needed)."""
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(sr), "-"]
    try:
        out = subprocess.run(cmd, capture_output=True, check=True).stdout
    except FileNotFoundError:
        raise SystemExit("ffmpeg was not found. Install ffmpeg and make sure it is on PATH.")
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"ffmpeg could not read {os.path.basename(path)}: {e.stderr.decode(errors='ignore')[-200:]}")
    return np.frombuffer(out, dtype=np.float32).copy()


def read_dataset(folder):
    """[(audio_path, text)] for every audio file in `folder` that has a .txt next to it with the same name."""
    rows = []
    for name in sorted(os.listdir(folder)):
        stem, ext = os.path.splitext(name)
        if ext.lower() not in AUDIO_EXT:
            continue
        txt = os.path.join(folder, stem + ".txt")
        if not os.path.exists(txt):
            continue
        with open(txt, "r", encoding="utf-8") as f:
            text = " ".join(f.read().split())
        if text:
            rows.append((os.path.join(folder, name), text))
    return rows


def split_rows(rows, eval_percent, seed=42, eval_cap=60):
    """Train / eval split that is the same every run, so before-and-after scores compare the same clips."""
    rows = list(rows)
    random.Random(seed).shuffle(rows)
    n_eval = min(eval_cap, max(1, round(len(rows) * eval_percent / 100))) if len(rows) >= 10 and eval_percent > 0 else 0
    return rows[n_eval:], rows[:n_eval]


def normalize(text):
    """Lower-case, no punctuation, one space between words: what is compared when scoring."""
    text = unicodedata.normalize("NFKC", text).lower()
    text = "".join(ch if (unicodedata.category(ch)[0] in "LN" or ch.isspace()) else " " for ch in text)
    return " ".join(text.split())


def _edit_distance(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def error_rate(refs, hyps, unit):
    """Word error rate ('wer') or character error rate ('cer'); 0 is perfect, 1 is every unit wrong."""
    errors = total = 0
    for r, h in zip(refs, hyps):
        r, h = normalize(r), normalize(h)
        if unit == "cer":
            r, h = r.replace(" ", ""), h.replace(" ", "")
            r, h = list(r), list(h)
        else:
            r, h = r.split(), h.split()
        errors += _edit_distance(r, h)
        total += max(1, len(r))
    return errors / max(1, total)
