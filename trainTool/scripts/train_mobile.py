"""Fine-tune a SMALL chat model for a phone, then test it and (optionally) make the GGUF file the phone app loads.

Differences from the PC flow: chat-format data in the base model's own chat template, only the assistant's reply is learned,
every weight is trained for tiny models (LoRA is used automatically for bigger ones), and the result can be exported as an f16 / q8_0 /
q4_k_m GGUF - the formats llama.cpp on the phone reads.

    python train_mobile.py --base <model folder> --train <rows.jsonl> --out <folder> --name <name> [--test <rows.jsonl>] [--quant q8_0]

Rows: {"messages":[{"role":"system","content":"..."},{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
(instruction/output rows work too). Writes <out>/model (Hugging Face files), <out>/gguf/<name>-<quant>.gguf and <out>/run.json.
"""
import argparse
import json
import math
import os
import random
import subprocess
import sys
import time

from speech_common import say

LLAMA = os.path.join(os.path.expanduser("~"), ".unsloth", "llama.cpp")


def read_rows(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            if isinstance(r.get("messages"), list) and len(r["messages"]) >= 2:
                rows.append(r["messages"])
            elif r.get("instruction") and r.get("output"):
                rows.append([{"role": "user", "content": (r["instruction"] + ("\n" + r["input"] if r.get("input") else ""))}, {"role": "assistant", "content": r["output"]}])
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--train", required=True)
    ap.add_argument("--test", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--name", default="model")
    ap.add_argument("--method", default="auto", choices=["auto", "full", "lora"])
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--accum", type=int, default=1)
    ap.add_argument("--max_length", type=int, default=512)
    ap.add_argument("--eval_percent", type=int, default=10)
    ap.add_argument("--match", default="first_line", choices=["first_line", "full"])
    ap.add_argument("--rank", type=int, default=32)
    ap.add_argument("--quant", default="none", choices=["none", "f16", "q8_0", "q4_k_m"])
    ap.add_argument("--max_steps", type=int, default=0)
    args = ap.parse_args()

    import torch
    from tqdm import tqdm
    from transformers import AutoModelForCausalLM, AutoTokenizer

    os.makedirs(args.out, exist_ok=True)
    say(f"[mobile] reading {args.train}")
    train = read_rows(args.train)
    if args.test:
        test = read_rows(args.test)
    else:
        random.Random(42).shuffle(train)
        n_test = min(200, round(len(train) * args.eval_percent / 100)) if len(train) >= 20 else 0
        test, train = train[:n_test], train[n_test:]
    if not train:
        say("[mobile] ERROR: no usable training rows (each needs messages ending with the assistant's reply).")
        sys.exit(1)

    say(f"[mobile] loading {args.base}")
    tok = AutoTokenizer.from_pretrained(args.base)
    if tok.pad_token_id is None:
        tok.pad_token = tok.eos_token
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    model = AutoModelForCausalLM.from_pretrained(args.base, torch_dtype=torch.float32).to(dev)
    n_params = sum(p.numel() for p in model.parameters())
    method = args.method if args.method != "auto" else ("full" if n_params <= 700e6 else "lora")
    big = n_params > 300e6
    say(f"[mobile] {n_params / 1e6:.0f}M parameters, training method: {method}" + (" (chosen automatically: too big to train every weight on 8 GB)" if args.method == "auto" and method == "lora" else ""))

    def encode(msgs):
        prompt = tok.apply_chat_template(msgs[:-1], tokenize=False, add_generation_prompt=True)
        full = tok.apply_chat_template(msgs, tokenize=False)
        answer = full[len(prompt):] if full.startswith(prompt) else msgs[-1]["content"] + (tok.eos_token or "")
        p = tok(prompt, add_special_tokens=False)["input_ids"]
        a = tok(answer, add_special_tokens=False)["input_ids"]
        return p + a, [-100] * len(p) + a

    data, too_long = [], 0
    for m in train:
        ids, lab = encode(m)
        if len(ids) > args.max_length:
            too_long += 1
            continue
        data.append((ids, lab))
    if too_long:
        say(f"[mobile] {too_long} example(s) left out: longer than {args.max_length} tokens")
    if not data:
        say("[mobile] ERROR: every example is longer than the maximum length; raise it.")
        sys.exit(1)
    say(f"[mobile] {len(data)} training examples, longest {max(len(x) for x, _ in data)} tokens; {len(test)} held back for testing")

    if method == "lora":
        from peft import LoraConfig, get_peft_model
        model = get_peft_model(model, LoraConfig(r=args.rank, lora_alpha=args.rank * 2, lora_dropout=0.05, bias="none", target_modules="all-linear", task_type="CAUSAL_LM"))
        model.print_trainable_parameters()
    if big:
        (model.base_model.model if method == "lora" else model).gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
        if method == "lora":
            model.enable_input_require_grads()
    (model.base_model.model if method == "lora" else model).config.use_cache = False

    params = [p for p in model.parameters() if p.requires_grad]
    try:
        import bitsandbytes as bnb
        opt = bnb.optim.AdamW8bit(params, lr=args.lr, weight_decay=0.0) if (big and dev == "cuda") else torch.optim.AdamW(params, lr=args.lr, weight_decay=0.0)
    except Exception:
        opt = torch.optim.AdamW(params, lr=args.lr, weight_decay=0.0)
    steps = args.epochs * math.ceil(len(data) / (args.batch * args.accum))
    if args.max_steps:
        steps = min(steps, args.max_steps)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / 20) * max(0.0, 1 - s / max(1, steps)))
    use_bf16 = dev == "cuda" and big and torch.cuda.is_bf16_supported()

    say(f"[mobile] training: {args.epochs} epoch(s), {steps} step(s), batch {args.batch} x {args.accum}, learning rate {args.lr:g}")
    model.train()
    bar = tqdm(total=steps, file=sys.stdout, ncols=100, mininterval=1.0)
    rng, step, micro, t0, done = random.Random(1), 0, 0, time.time(), False
    for ep in range(args.epochs):
        rng.shuffle(data)
        for i in range(0, len(data), args.batch):
            batch = data[i:i + args.batch]
            n = max(len(x) for x, _ in batch)
            pad = tok.pad_token_id or 0
            ids = torch.tensor([x + [pad] * (n - len(x)) for x, _ in batch]).to(dev)
            lab = torch.tensor([y + [-100] * (n - len(y)) for _, y in batch]).to(dev)
            att = torch.tensor([[1] * len(x) + [0] * (n - len(x)) for x, _ in batch]).to(dev)
            with torch.autocast(dev, dtype=torch.bfloat16, enabled=use_bf16):
                loss = model(input_ids=ids, attention_mask=att, labels=lab).loss / args.accum
            loss.backward()
            micro += 1
            if micro % args.accum == 0:
                torch.nn.utils.clip_grad_norm_(params, 1.0)
                opt.step(); sched.step(); opt.zero_grad(set_to_none=True)
                step += 1
                bar.set_postfix(loss=f"{loss.item() * args.accum:.3f}", epoch=f"{ep + 1}/{args.epochs}")
                bar.update(1)
                if step >= steps:
                    done = True
                    break
        if done:
            break
    bar.close()
    say(f"[mobile] trained {step} steps in {time.time() - t0:.0f} s")

    if method == "lora":
        model = model.merge_and_unload()
    model.config.use_cache = True
    model_dir = os.path.join(args.out, "model")
    model.save_pretrained(model_dir, safe_serialization=True)
    tok.save_pretrained(model_dir)
    say(f"[mobile] saved the model to {model_dir}")

    exact = kind = 0
    if test:
        say(f"[mobile] testing on {len(test)} held-out example(s)")
        model.eval()
        misses = []
        for msgs in test:
            prompt = tok.apply_chat_template(msgs[:-1], tokenize=False, add_generation_prompt=True)
            ids = tok(prompt, return_tensors="pt", add_special_tokens=False).input_ids.to(dev)
            with torch.no_grad():
                out = model.generate(ids, max_new_tokens=120, do_sample=False, pad_token_id=tok.pad_token_id or 0)
            got = tok.decode(out[0, ids.shape[1]:], skip_special_tokens=True).strip()
            want = msgs[-1]["content"].strip()
            if args.match == "first_line":
                got, want = got.split("\n")[0], want.split("\n")[0]
            exact += got == want
            kind += got[:4] == want[:4]
            if got != want and len(misses) < 8:
                misses.append((msgs[-2]["content"].replace("\n", " ")[:90], want[:90], got[:90]))
        say(f"[mobile] held-out: {exact}/{len(test)} exact ({100 * exact / len(test):.0f}%), {kind}/{len(test)} start the same way (first 4 characters)")
        for q, w, g in misses:
            say(f"[mobile]   asked: {q}\n[mobile]     want: {w}\n[mobile]     got:  {g}")

    gguf_info = None
    if args.quant != "none":
        say(f"[mobile] making the phone file ({args.quant})")
        convert = os.path.join(LLAMA, "convert_hf_to_gguf.py")
        if not os.path.exists(convert):
            say(f"[mobile] ERROR: the GGUF converter was not found at {convert}. Export a model with the FineTune LLM page once so it is installed.")
            sys.exit(1)
        gdir = os.path.join(args.out, "gguf")
        os.makedirs(gdir, exist_ok=True)
        final = os.path.join(gdir, f"{args.name}-{args.quant}.gguf")
        direct = "q8_0" if args.quant == "q8_0" else "f16"
        first = final if args.quant in ("f16", "q8_0") else os.path.join(gdir, f"{args.name}-f16.gguf")
        r = subprocess.run([sys.executable, convert, model_dir, "--outfile", first, "--outtype", direct], capture_output=True, text=True, encoding="utf-8", errors="replace")
        if r.returncode != 0 or not os.path.exists(first):
            say("[mobile] ERROR: the GGUF conversion failed: " + (r.stderr.strip().splitlines() or ["unknown error"])[-1])
            sys.exit(1)
        if args.quant == "q4_k_m":
            quantize = next((p for p in (os.path.join(LLAMA, "build", "bin", "Release", "llama-quantize.exe"), os.path.join(LLAMA, "build", "bin", "llama-quantize")) if os.path.exists(p)), None)
            if not quantize:
                say("[mobile] ERROR: llama-quantize was not found, so q4_k_m cannot be made. Choose q8_0 or f16.")
                sys.exit(1)
            q = subprocess.run([quantize, first, final, "Q4_K_M"], capture_output=True, text=True, encoding="utf-8", errors="replace")
            if q.returncode != 0 or not os.path.exists(final):
                say("[mobile] ERROR: the quantization failed: " + (q.stderr.strip().splitlines() or ["unknown error"])[-1])
                sys.exit(1)
            os.remove(first)
        mb = os.path.getsize(final) / 1048576
        gguf_info = {"file": final, "mb": round(mb, 1), "quant": args.quant}
        say(f"[mobile] GGUF saved: {final} ({mb:.0f} MB)")

    with open(os.path.join(args.out, "run.json"), "w", encoding="utf-8") as f:
        json.dump({"base": args.base, "method": method, "params_m": round(n_params / 1e6), "epochs": args.epochs, "examples": len(data), "tested": len(test), "exact": exact, "kind": kind, "gguf": gguf_info}, f, indent=2)
    if test:
        say(f"[mobile] RESULT {exact}/{len(test)} exact" + (f", {gguf_info['mb']:.0f} MB {args.quant}" if gguf_info else ""))
    say("[mobile] done.")


if __name__ == "__main__":
    main()
