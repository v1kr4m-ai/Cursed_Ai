"""Speaks a list of texts with XTTS-v2 (train/speech/models/XTTS-v2), fully offline. The model is loaded ONCE for the whole list.

Usage: python xtts_run.py <job.json>
job.json: { modelDir, items: [{ text, parts?, language, referenceAudio?, speaker?, output }] }
  parts: the text already split into pieces of < ~230 characters (else it is split here at sentence ends); the pieces are
  spoken one by one and joined with a short pause. A voice comes from referenceAudio (a 6-30 s clip of the voice to copy) or a
  built-in `speaker` name (speakers_xtts.pth); with neither, the model's first built-in speaker.
Prints one tqdm-style progress line per item and "[xtts] ..." lines; an item that fails is reported and the rest go on. Exit code 1 if none was made.
"""
import json
import os
import re
import sys
import time
import wave

import numpy as np

SR = 24000
PAUSE = 0.25  # seconds of silence between pieces


def split(text, limit=230):
    out = []
    for s in re.split(r"(?<=[.!?।॥؟…])\s+", " ".join(text.split())):
        while len(s) > limit:
            i = max(s.rfind(",", 0, limit), s.rfind(" ", 0, limit))
            i = i if i > limit * 0.3 else limit
            out.append(s[:i].strip())
            s = s[i:].strip(" ,")
        if s:
            out.append(s)
    return out


def main():
    job = json.load(open(sys.argv[1], encoding="utf-8"))
    items = job["items"]
    model_dir = job["modelDir"]
    import torch
    from TTS.tts.configs.xtts_config import XttsConfig
    from TTS.tts.models.xtts import Xtts

    t0 = time.time()
    print("[xtts] loading model ...", flush=True)
    config = XttsConfig()
    config.load_json(os.path.join(model_dir, "config.json"))
    model = Xtts.init_from_config(config)
    model.load_checkpoint(config, checkpoint_dir=model_dir, eval=True, use_deepspeed=False)
    gpu = torch.cuda.is_available()
    if gpu:
        model.cuda()
    else:
        print("[xtts] warning: no CUDA GPU found, running on the CPU - this will be very slow", flush=True)
    print(f"[xtts] model loaded in {time.time() - t0:.1f} s (once for {len(items)} item{'s' if len(items) != 1 else ''})", flush=True)

    latents = {}  # a voice is analysed once however many items use it

    def voice(it):
        ref = it.get("referenceAudio")
        if ref:
            if ("ref", ref) not in latents:
                latents[("ref", ref)] = model.get_conditioning_latents(audio_path=[ref], gpt_cond_len=config.gpt_cond_len, max_ref_length=config.max_ref_len, sound_norm_refs=config.sound_norm_refs)
            return latents[("ref", ref)]
        names = list(model.speaker_manager.speakers.keys())
        name = it.get("speaker") if it.get("speaker") in names else names[0]
        s = model.speaker_manager.speakers[name]
        return s["gpt_cond_latent"], s["speaker_embedding"]

    made = 0
    t1 = time.time()
    for n, it in enumerate(items, 1):
        pct = int((n - 1) * 100 / len(items))
        print(f" {pct:3d}%|{'#' * (pct // 10):<10}| {n - 1}/{len(items)} [{time.time() - t1:.0f}s]", flush=True)
        try:
            lang = it.get("language") or "hi"
            parts = it.get("parts") or split(it["text"])
            if not parts:
                raise ValueError("no text")
            latent, emb = voice(it)
            t2 = time.time()
            chunks = []
            for p in parts:
                if len(p) > 250:
                    print(f"[xtts] item {n}: a piece is {len(p)} characters (over 250), it may be cut short", flush=True)
                out = model.inference(p, lang, latent, emb, temperature=0.7, enable_text_splitting=False)
                chunks += [np.clip(np.asarray(out["wav"], dtype=np.float32), -1.0, 1.0), np.zeros(int(SR * PAUSE), dtype=np.float32)]
            wav = np.concatenate(chunks[:-1])
            os.makedirs(os.path.dirname(os.path.abspath(it["output"])), exist_ok=True)
            with wave.open(it["output"], "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((wav * 32767).astype(np.int16).tobytes())
            made += 1
            print(f"[xtts] item {n}/{len(items)} ({lang}) saved {it['output']} ({len(wav) / SR:.1f} s of audio) in {time.time() - t2:.1f} s", flush=True)
        except Exception as e:  # one bad item must not stop the rest
            print(f"[xtts] item {n}/{len(items)} FAILED: {type(e).__name__}: {e}", flush=True)
    print(f" 100%|{'#' * 10}| {len(items)}/{len(items)} [{time.time() - t1:.0f}s]", flush=True)
    peak = torch.cuda.max_memory_allocated() / 2**30 if gpu else 0
    print(f"[xtts] done: {made} of {len(items)} made in {time.time() - t0:.1f} s, peak GPU memory {peak:.1f} GB", flush=True)
    sys.exit(0 if made else 1)


if __name__ == "__main__":
    main()
