"""Offline LLM QLoRA fine-tune, driven entirely by CLI args from the Electron app.

Dataset format: JSONL, one object per line, Alpaca-style:
    {"instruction": "...", "input": "", "output": "..."}
"input" is optional and may be omitted or empty.

Usage (also how the Electron app invokes it):
    python train.py --base_model <local HF folder> --dataset data.jsonl \
        --output_dir out --r 16 --alpha 16 --epochs 3 --learning_rate 2e-4 \
        --batch_size 2 --max_seq_length 2048 [--export_gguf] [--ollama_name my-model]

Everything after the base model + deps are downloaded once (while online) runs
fully offline — no network calls at train time.
"""
import argparse
import json
import os
import subprocess
import sys


PROMPT_TEMPLATE = """### Instruction:
{instruction}
{input_block}
### Response:
{output}"""


def load_alpaca_jsonl(path):
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def to_text(example, eos_token):
    instruction = example.get("instruction", "").strip()
    inp = example.get("input", "").strip()
    output = example.get("output", "").strip()
    input_block = f"\n### Input:\n{inp}\n" if inp else ""
    text = PROMPT_TEMPLATE.format(instruction=instruction, input_block=input_block, output=output)
    return text + eos_token


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base_model", required=True, help="Local folder with a downloaded HF/Unsloth checkpoint")
    ap.add_argument("--dataset", required=True, help="Path to an Alpaca-style .jsonl file")
    ap.add_argument("--output_dir", required=True)
    ap.add_argument("--r", type=int, default=16, help="LoRA rank")
    ap.add_argument("--alpha", type=int, default=16, help="LoRA alpha")
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--learning_rate", type=float, default=2e-4)
    ap.add_argument("--batch_size", type=int, default=2)
    ap.add_argument("--max_seq_length", type=int, default=2048)
    ap.add_argument("--export_gguf", action="store_true", help="Also export a q4_k_m GGUF for Ollama")
    ap.add_argument("--ollama_name", default="", help="If set (with --export_gguf), runs `ollama create <name>` afterwards")
    args = ap.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    print(f"[train.py] loading base model from {args.base_model}", flush=True)
    from unsloth import FastLanguageModel, is_bfloat16_supported
    from trl import SFTTrainer, SFTConfig
    from datasets import Dataset

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base_model,
        max_seq_length=args.max_seq_length,
        dtype=None,          # auto: bf16/fp16 per GPU support
        load_in_4bit=True,   # QLoRA — fits an 8GB card
    )

    model = FastLanguageModel.get_peft_model(
        model,
        r=args.r,
        lora_alpha=args.alpha,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=42,
    )

    print(f"[train.py] loading dataset from {args.dataset}", flush=True)
    rows = load_alpaca_jsonl(args.dataset)
    if not rows:
        print("[train.py] ERROR: dataset is empty.", flush=True)
        sys.exit(1)
    texts = [to_text(r, tokenizer.eos_token) for r in rows]
    dataset = Dataset.from_dict({"text": texts})
    print(f"[train.py] {len(dataset)} training examples", flush=True)

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=args.max_seq_length,
        args=SFTConfig(
            output_dir=args.output_dir,
            per_device_train_batch_size=args.batch_size,
            gradient_accumulation_steps=4,
            num_train_epochs=args.epochs,
            learning_rate=args.learning_rate,
            # Unsloth loads the model in bf16 when the GPU supports it, and refuses fp16 on top of that. (Reading the dtype out of
            # model.config no longer works: newer transformers hand back a torch.dtype, not the string "bfloat16".)
            fp16=not is_bfloat16_supported(),
            bf16=is_bfloat16_supported(),
            logging_steps=1,
            optim="adamw_8bit",
            weight_decay=0.01,
            lr_scheduler_type="linear",
            seed=42,
            save_strategy="epoch",
            report_to="none",
        ),
    )

    print("[train.py] starting training", flush=True)
    trainer.train()

    adapter_dir = os.path.join(args.output_dir, "adapter")
    print(f"[train.py] saving LoRA adapter to {adapter_dir}", flush=True)
    model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)

    if args.export_gguf:
        gguf_dir = os.path.join(args.output_dir, "gguf")
        print(f"[train.py] exporting merged GGUF (q4_k_m) to {gguf_dir}", flush=True)
        model.save_pretrained_gguf(gguf_dir, tokenizer, quantization_method="q4_k_m")

        if args.ollama_name:
            gguf_files = [f for f in os.listdir(gguf_dir) if f.endswith(".gguf")]
            if not gguf_files:
                print("[train.py] WARNING: no .gguf file found, skipping ollama create", flush=True)
            else:
                gguf_path = os.path.join(gguf_dir, gguf_files[0])
                modelfile_path = os.path.join(gguf_dir, "Modelfile")
                with open(modelfile_path, "w", encoding="utf-8") as f:
                    f.write(f"FROM {gguf_path}\n")
                print(f"[train.py] running: ollama create {args.ollama_name} -f {modelfile_path}", flush=True)
                subprocess.run(["ollama", "create", args.ollama_name, "-f", modelfile_path], check=False)

    print("[train.py] done.", flush=True)


if __name__ == "__main__":
    main()
