"""Turn a clips folder (audio + .txt) into the layout the XTTS trainer reads: 22.05 kHz mono wavs, metadata.csv and a reference voice clip.

    python prepare_tts.py --dataset <clips folder> --out <prepared folder>

Clips shorter than 1 s or longer than 11 s are left out (XTTS trains on short utterances).
"""
import argparse
import os
import subprocess
import wave

from speech_common import AUDIO_EXT, read_dataset, say

MIN_S, MAX_S = 1.0, 11.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    rows = read_dataset(args.dataset)
    if not rows:
        say("[speech] ERROR: no clips with a transcript were found.")
        raise SystemExit(1)
    wav_dir = os.path.join(args.out, "wavs")
    os.makedirs(wav_dir, exist_ok=True)
    kept, short, long_, bad = [], 0, 0, 0
    for path, text in rows:
        stem = os.path.splitext(os.path.basename(path))[0]
        dst = os.path.join(wav_dir, stem + ".wav")
        r = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", path, "-ac", "1", "-ar", "22050", "-sample_fmt", "s16", dst], capture_output=True)
        if r.returncode != 0 or not os.path.exists(dst):
            say(f"[speech] could not convert {os.path.basename(path)}: {r.stderr.decode(errors='ignore')[-160:]}")
            bad += 1
            continue
        with wave.open(dst, "rb") as w:
            sec = w.getnframes() / w.getframerate()
        if sec < MIN_S:
            short += 1; os.remove(dst); continue
        if sec > MAX_S:
            long_ += 1; os.remove(dst); continue
        kept.append((stem, text.replace("|", " "), sec))
    if not kept:
        say("[speech] ERROR: no clip between 1 and 11 seconds long was left.")
        raise SystemExit(1)
    with open(os.path.join(args.out, "metadata.csv"), "w", encoding="utf-8") as f:
        for stem, text, _ in kept:
            f.write(f"{stem}|{text}|{text}\n")
    best = max((k for k in kept if k[2] >= 5.0), key=lambda k: k[2], default=max(kept, key=lambda k: k[2]))
    with open(os.path.join(wav_dir, best[0] + ".wav"), "rb") as s, open(os.path.join(args.out, "reference.wav"), "wb") as d:
        d.write(s.read())
    total = sum(k[2] for k in kept)
    say(f"[speech] prepared {len(kept)} clip(s), {total / 60:.1f} minutes of speech. Left out: {short} too short, {long_} too long, {bad} unreadable.")
    say(f"[speech] reference voice clip: {best[0]} ({best[2]:.1f} s)")
    if total < 600:
        say("[speech] NOTE: under 10 minutes of speech. Fine-tuning works best with 30 minutes or more of clean, single-speaker audio.")
    say("[speech] done.")


if __name__ == "__main__":
    main()
