"""Say a sentence with an XTTS voice model (a fine-tuned one, or the base model to clone a voice from a reference clip).

    python tts_speak.py --model_dir <folder with model.pth, config.json, vocab.json> --reference <voice.wav> --text "..." --language hi --out <file.wav>

The last line printed is JSON: {"out": "<file.wav>", "seconds": 3.2}.
"""
import argparse
import json
import wave

import numpy as np


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model_dir", required=True)
    ap.add_argument("--reference", required=True)
    ap.add_argument("--text", required=True)
    ap.add_argument("--language", default="hi")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    import torch
    from TTS.tts.configs.xtts_config import XttsConfig
    from TTS.tts.models.xtts import Xtts

    import os
    config = XttsConfig()
    config.load_json(os.path.join(args.model_dir, "config.json"))
    model = Xtts.init_from_config(config)
    model.load_checkpoint(config, checkpoint_dir=args.model_dir, eval=True, use_deepspeed=False)
    if torch.cuda.is_available():
        model.cuda()
    latent, speaker = model.get_conditioning_latents(audio_path=[args.reference], gpt_cond_len=model.config.gpt_cond_len, max_ref_length=model.config.max_ref_len, sound_norm_refs=model.config.sound_norm_refs)
    out = model.inference(args.text, args.language, latent, speaker, temperature=0.7)
    wav = np.clip(np.asarray(out["wav"], dtype=np.float32), -1.0, 1.0)
    pcm = (wav * 32767).astype(np.int16)
    with wave.open(args.out, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(pcm.tobytes())
    print(json.dumps({"out": args.out, "seconds": round(len(pcm) / 24000, 2)}), flush=True)


if __name__ == "__main__":
    main()
