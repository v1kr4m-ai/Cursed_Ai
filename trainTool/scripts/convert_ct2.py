"""Convert a fine-tuned Whisper model (the folder made by train_whisper.py) to the faster-whisper / CTranslate2 format,
so programs such as Cursed_Vishleshan can run it.

    python convert_ct2.py --model <trained model folder> --out <new folder> [--quantization float16]

The new folder gets model.bin, config.json, the vocabulary, tokenizer.json and preprocessor_config.json.
"""
import argparse
import os
import sys

from speech_common import say


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--quantization", default="float16", choices=["float16", "int8", "int8_float16", "float32"])
    args = ap.parse_args()

    if not os.path.exists(os.path.join(args.model, "config.json")):
        say("[speech] ERROR: that is not a model folder (no config.json).")
        sys.exit(1)
    try:
        from ctranslate2.converters import TransformersConverter
    except ImportError:
        say("[speech] ERROR: the ctranslate2 package is missing (pip install ctranslate2).")
        sys.exit(1)

    # Newer transformers save the audio settings as processor_config.json; faster-whisper reads preprocessor_config.json.
    if not os.path.exists(os.path.join(args.model, "preprocessor_config.json")):
        from transformers import WhisperProcessor
        WhisperProcessor.from_pretrained(args.model).feature_extractor.save_pretrained(args.model)
    say(f"[speech] converting {args.model} ({args.quantization})")
    TransformersConverter(args.model, copy_files=["tokenizer.json", "preprocessor_config.json"]).convert(args.out, quantization=args.quantization, force=True)
    need = ["model.bin", "config.json", "tokenizer.json", "preprocessor_config.json"]
    missing = [n for n in need if not os.path.exists(os.path.join(args.out, n))]
    if missing or not any(os.path.exists(os.path.join(args.out, v)) for v in ("vocabulary.json", "vocabulary.txt")):
        say(f"[speech] ERROR: the converted folder is incomplete (missing {', '.join(missing) or 'vocabulary'}).")
        sys.exit(1)
    mb = os.path.getsize(os.path.join(args.out, "model.bin")) / 1048576
    say(f"[speech] saved {args.out} (model.bin {mb:.0f} MB)")
    say("[speech] done.")


if __name__ == "__main__":
    main()
