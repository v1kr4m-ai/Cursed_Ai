"""Transcribe one audio file with a (fine-tuned) Whisper model; the last line printed is JSON: {"text": "..."}.

    python transcribe_file.py --model <folder or HF id> --audio <file> --language hi
"""
import argparse
import json

from speech_common import load_audio


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--audio", required=True)
    ap.add_argument("--language", default="hi")
    args = ap.parse_args()

    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    processor = WhisperProcessor.from_pretrained(args.model, language=args.language, task="transcribe")
    model = WhisperForConditionalGeneration.from_pretrained(args.model, torch_dtype=torch.float16 if dev == "cuda" else torch.float32).to(dev).eval()
    audio = load_audio(args.audio, 16000)
    parts = []
    for i in range(0, max(1, len(audio)), 16000 * 30):   # long recordings: 30 s at a time
        chunk = audio[i:i + 16000 * 30]
        if len(chunk) < 1600:
            continue
        feats = processor.feature_extractor(chunk, sampling_rate=16000, return_tensors="pt").input_features.to(dev, dtype=model.dtype)
        with torch.no_grad():
            ids = model.generate(input_features=feats, language=args.language, task="transcribe", max_new_tokens=220)
        parts.append(processor.tokenizer.batch_decode(ids, skip_special_tokens=True)[0].strip())
    print(json.dumps({"text": " ".join(p for p in parts if p)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
