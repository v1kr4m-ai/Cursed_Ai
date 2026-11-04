"""Classifies XTTS-v2's built-in speakers by gender from the real model: speaks one English sentence per speaker, measures the
median fundamental frequency (librosa pyin) and writes seriesTool/xttsVoices.json [{name, gender, f0}].
Usage: train/speech/tts/env/Scripts/python trainTool/scripts/xtts_classify.py <modelDir> <scratchDir> <out.json>
female: median F0 > 165 Hz; male: below; 150-180 Hz is flagged "ambiguous" (the app does not auto-pick those).
"""
import json, os, sys, wave
import numpy as np

SR = 24000
TEXT = "The morning light came through the window, and she asked him to wait a little longer."


def main():
    model_dir, scratch, out = sys.argv[1:4]
    import librosa
    from TTS.tts.configs.xtts_config import XttsConfig
    from TTS.tts.models.xtts import Xtts
    cfg = XttsConfig(); cfg.load_json(os.path.join(model_dir, "config.json"))
    m = Xtts.init_from_config(cfg); m.load_checkpoint(cfg, checkpoint_dir=model_dir, eval=True, use_deepspeed=False)
    import torch
    if torch.cuda.is_available(): m.cuda()
    os.makedirs(scratch, exist_ok=True)
    rows = []
    for name, s in m.speaker_manager.speakers.items():
        wav = np.clip(np.asarray(m.inference(TEXT, "en", s["gpt_cond_latent"], s["speaker_embedding"], temperature=0.7, enable_text_splitting=False)["wav"], dtype=np.float32), -1, 1)
        with wave.open(os.path.join(scratch, name.replace(" ", "_") + ".wav"), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((wav * 32767).astype(np.int16).tobytes())
        f0, voiced, _ = librosa.pyin(wav, fmin=60, fmax=400, sr=SR)
        f0 = f0[voiced & ~np.isnan(f0)]
        med = float(np.median(f0)) if len(f0) else 0.0
        row = {"name": name, "gender": "female" if med > 165 else "male", "f0": round(med, 1)}
        if 150 <= med <= 180: row["ambiguous"] = True
        rows.append(row); print(row, flush=True)
    rows.sort(key=lambda r: (r["gender"], r["f0"]))
    json.dump(rows, open(out, "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    main()
