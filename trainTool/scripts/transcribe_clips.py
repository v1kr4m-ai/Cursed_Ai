"""Write a first-draft transcript (.txt) beside every clip that has none, using a Whisper model; the page then lets you correct them.

    python transcribe_clips.py --model <folder or HF id> --dataset <clips folder> --language hi
"""
import argparse
import os
import sys

from speech_common import AUDIO_EXT, load_audio, say


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--language", default="hi")
    ap.add_argument("--redo", action="store_true", help="Also replace transcripts that already exist")
    args = ap.parse_args()

    import torch
    from tqdm import tqdm
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    say(f"[speech] loading {args.model}")
    processor = WhisperProcessor.from_pretrained(args.model, language=args.language, task="transcribe")
    model = WhisperForConditionalGeneration.from_pretrained(args.model, torch_dtype=torch.float16 if dev == "cuda" else torch.float32).to(dev).eval()

    todo = []
    for name in sorted(os.listdir(args.dataset)):
        stem, ext = os.path.splitext(name)
        if ext.lower() in AUDIO_EXT and (args.redo or not os.path.exists(os.path.join(args.dataset, stem + ".txt"))):
            todo.append((name, stem))
    say(f"[speech] {len(todo)} clip(s) to transcribe")
    bar = tqdm(total=len(todo), file=sys.stdout, ncols=100, mininterval=1.0)
    for name, stem in todo:
        try:
            audio = load_audio(os.path.join(args.dataset, name), 16000)
            feats = processor.feature_extractor(audio[: 16000 * 30], sampling_rate=16000, return_tensors="pt").input_features.to(dev, dtype=model.dtype)
            with torch.no_grad():
                ids = model.generate(input_features=feats, language=args.language, task="transcribe", max_new_tokens=220)
            text = processor.tokenizer.batch_decode(ids, skip_special_tokens=True)[0].strip()
            with open(os.path.join(args.dataset, stem + ".txt"), "w", encoding="utf-8") as f:
                f.write(text)
            say(f"[speech] {name}: {text}")
        except Exception as e:
            say(f"[speech] could not transcribe {name}: {e}")
        bar.update(1)
    bar.close()
    say("[speech] done. Read through the drafts and correct them before training.")


if __name__ == "__main__":
    main()
