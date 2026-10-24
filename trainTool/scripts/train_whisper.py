"""Fine-tune Whisper on a folder of clips (audio + a .txt transcript with the same name) - LoRA or full - and score it before and after.

Usage (the app runs this):
    python train_whisper.py --base_model <folder or HF id> --dataset <clips folder> --output_dir <out> --language hi
        [--method lora|full] [--epochs 5] [--learning_rate 1e-3] [--batch_size 8] [--grad_accum 2] [--rank 32] [--eval_percent 10]

Writes <output_dir>/model (the merged model, loads on its own) and <output_dir>/run.json (settings and scores).
"""
import argparse
import json
import math
import os
import random
import sys
import time

import numpy as np
from speech_common import error_rate, load_audio, read_dataset, say, split_rows

MAX_SECONDS = 30.0   # Whisper listens to 30 s at a time
MIN_SECONDS = 0.3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base_model", required=True)
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--output_dir", required=True)
    ap.add_argument("--language", default="hi", help="Whisper language code: hi, ar, zh, en ...")
    ap.add_argument("--method", default="lora", choices=["lora", "full"])
    ap.add_argument("--epochs", type=int, default=5)
    ap.add_argument("--learning_rate", type=float, default=1e-3)
    ap.add_argument("--batch_size", type=int, default=8)
    ap.add_argument("--grad_accum", type=int, default=2)
    ap.add_argument("--rank", type=int, default=32)
    ap.add_argument("--eval_percent", type=int, default=10)
    ap.add_argument("--max_steps", type=int, default=0, help="Stop after this many steps (0 = run every epoch). For quick checks.")
    args = ap.parse_args()
    unit = "cer" if args.language.startswith("zh") or args.language in ("ja", "th") else "wer"

    import torch
    from tqdm import tqdm
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    if not torch.cuda.is_available():
        say("[speech] WARNING: no GPU found, training on the CPU will be very slow.")
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    use_bf16 = dev == "cuda" and torch.cuda.is_bf16_supported()

    os.makedirs(args.output_dir, exist_ok=True)
    say(f"[speech] reading clips from {args.dataset}")
    rows = read_dataset(args.dataset)
    if not rows:
        say("[speech] ERROR: no clips with a transcript were found (each audio file needs a .txt with the same name).")
        sys.exit(1)

    say(f"[speech] loading {args.base_model}")
    processor = WhisperProcessor.from_pretrained(args.base_model, language=args.language, task="transcribe")
    tok = processor.tokenizer
    model = WhisperForConditionalGeneration.from_pretrained(args.base_model, torch_dtype=torch.float32)
    model.generation_config.language = args.language
    model.generation_config.task = "transcribe"
    model.generation_config.forced_decoder_ids = None
    model.config.forced_decoder_ids = None
    model.to(dev)

    say("[speech] decoding audio")
    items = []
    skipped = 0
    for path, text in rows:
        try:
            audio = load_audio(path, 16000)
        except Exception as e:
            say(f"[speech] skipping {os.path.basename(path)}: {e}")
            skipped += 1
            continue
        sec = len(audio) / 16000
        if sec < MIN_SECONDS or sec > MAX_SECONDS:
            skipped += 1
            continue
        items.append((audio, text, os.path.basename(path)))
    if skipped:
        say(f"[speech] {skipped} clip(s) skipped (unreadable, under {MIN_SECONDS} s or over {MAX_SECONDS:.0f} s).")
    train_items, eval_items = split_rows(items, args.eval_percent)
    if not train_items:
        say("[speech] ERROR: nothing left to train on.")
        sys.exit(1)
    say(f"[speech] {len(train_items)} training clips, {len(eval_items)} held back to score the model on")

    def features(batch_audio):
        return processor.feature_extractor(batch_audio, sampling_rate=16000, return_tensors="pt").input_features

    def evaluate(tag):
        if not eval_items:
            return None
        model.eval()
        model.config.use_cache = True
        hyps = []
        with torch.no_grad():
            for i in range(0, len(eval_items), 8):
                chunk = eval_items[i:i + 8]
                feats = features([a for a, _, _ in chunk]).to(dev)
                with torch.autocast(dev, dtype=torch.bfloat16, enabled=use_bf16):
                    ids = model.generate(input_features=feats, language=args.language, task="transcribe", max_new_tokens=200)
                hyps += tok.batch_decode(ids, skip_special_tokens=True)
        score = error_rate([t for _, t, _ in eval_items], hyps, unit)
        say(f"[speech] {tag}: {unit.upper()} {score * 100:.1f}%  (0% is perfect; measured on {len(eval_items)} clips the model never trained on)")
        for (a, t, n), h in list(zip(eval_items, hyps))[:3]:
            say(f"[speech]   {n}\n[speech]     expected: {t}\n[speech]     heard:    {h}")
        return score

    before = evaluate("before training")

    if args.method == "lora":
        from peft import LoraConfig, get_peft_model
        model = get_peft_model(model, LoraConfig(r=args.rank, lora_alpha=args.rank * 2, lora_dropout=0.05, bias="none", target_modules=["q_proj", "k_proj", "v_proj", "out_proj"]))
        model.print_trainable_parameters()
    base_for_gc = model.base_model.model if args.method == "lora" else model
    if "tiny" not in args.base_model.lower():
        base_for_gc.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    base_for_gc.config.use_cache = False

    params = [p for p in model.parameters() if p.requires_grad]
    lr = args.learning_rate if args.method == "lora" else min(args.learning_rate, 1e-4)
    try:
        import bitsandbytes as bnb
        opt = bnb.optim.AdamW8bit(params, lr=lr, weight_decay=0.01) if dev == "cuda" else torch.optim.AdamW(params, lr=lr, weight_decay=0.01)
    except Exception:
        opt = torch.optim.AdamW(params, lr=lr, weight_decay=0.01)

    steps_per_epoch = max(1, math.ceil(len(train_items) / (args.batch_size * args.grad_accum)))
    total_steps = steps_per_epoch * args.epochs
    if args.max_steps:
        total_steps = min(total_steps, args.max_steps)
    warm = max(1, int(total_steps * 0.1))
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / warm) * max(0.0, (total_steps - s) / max(1, total_steps - warm)) if s >= warm else (s + 1) / warm)
    start_id = model.config.decoder_start_token_id if args.method == "full" else model.base_model.model.config.decoder_start_token_id

    def make_batch(chunk):
        feats = features([a for a, _, _ in chunk]).to(dev)
        labels = [tok(t).input_ids for _, t, _ in chunk]
        labels = [l[1:] if l and l[0] == start_id else l for l in labels]
        width = max(len(l) for l in labels)
        lab = torch.full((len(labels), width), -100, dtype=torch.long)
        for i, l in enumerate(labels):
            lab[i, :len(l)] = torch.tensor(l)
        return feats, lab.to(dev)

    say(f"[speech] training: {args.method}, {args.epochs} epoch(s), {total_steps} step(s), batch {args.batch_size} x {args.grad_accum}, learning rate {lr:g}")
    model.train()
    bar = tqdm(total=total_steps, file=sys.stdout, dynamic_ncols=False, ncols=100, mininterval=1.0)
    step = 0
    rng = random.Random(1)
    t0 = time.time()
    done = False
    for epoch in range(args.epochs):
        order = list(range(len(train_items)))
        rng.shuffle(order)
        micro = [order[i:i + args.batch_size] for i in range(0, len(order), args.batch_size)]
        for k, idx in enumerate(micro):
            feats, lab = make_batch([train_items[i] for i in idx])
            with torch.autocast(dev, dtype=torch.bfloat16, enabled=use_bf16):
                loss = model(input_features=feats, labels=lab).loss / args.grad_accum
            loss.backward()
            if (k + 1) % args.grad_accum == 0 or k == len(micro) - 1:
                torch.nn.utils.clip_grad_norm_(params, 1.0)
                opt.step(); sched.step(); opt.zero_grad(set_to_none=True)
                step += 1
                bar.set_postfix(loss=f"{loss.item() * args.grad_accum:.3f}", epoch=f"{epoch + 1}/{args.epochs}")
                bar.update(1)
                if step >= total_steps:
                    done = True
                    break
        if done:
            break
    bar.close()
    say(f"[speech] trained {step} steps in {time.time() - t0:.0f} s")

    if args.method == "lora":
        model = model.merge_and_unload()
    model.config.use_cache = True
    after = evaluate("after training")

    out = os.path.join(args.output_dir, "model")
    say(f"[speech] saving the model to {out}")
    model.save_pretrained(out)
    processor.save_pretrained(out)
    processor.feature_extractor.save_pretrained(out)   # writes preprocessor_config.json, which faster-whisper needs
    with open(os.path.join(args.output_dir, "run.json"), "w", encoding="utf-8") as f:
        json.dump({"base": args.base_model, "language": args.language, "method": args.method, "epochs": args.epochs, "clips": len(train_items), "metric": unit, "before": before, "after": after}, f, indent=2)
    if before is not None and after is not None:
        say(f"[speech] RESULT {unit.upper()} {before * 100:.1f}% -> {after * 100:.1f}%")
    say("[speech] done.")


if __name__ == "__main__":
    main()
