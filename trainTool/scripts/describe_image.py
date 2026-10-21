"""Describes one or more images with Florence-2 (same locally-cached model
FluxGym itself uses — see app/scripts/caption_images.py for the LoRA-caption
variant of this). Prints a JSON array of {file, description} to stdout,
loading the model once regardless of how many images are passed.

Usage: python describe_image.py --file a.png --file b.jpg
"""
import argparse
import json
import sys

MODEL_ID = "multimodalart/Florence-2-large-no-flash-attn"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', action='append', required=True)
    args = ap.parse_args()

    import torch
    from PIL import Image
    from transformers import AutoModelForCausalLM, AutoProcessor

    device = "cuda" if torch.cuda.is_available() else "cpu"
    torch_dtype = torch.float16 if device == "cuda" else torch.float32
    print(f"[describe] loading Florence-2 on {device}…", file=sys.stderr, flush=True)
    model = AutoModelForCausalLM.from_pretrained(MODEL_ID, torch_dtype=torch_dtype, trust_remote_code=True).to(device)
    processor = AutoProcessor.from_pretrained(MODEL_ID, trust_remote_code=True)

    results = []
    for path in args.file:
        print(f"[describe] {path}", file=sys.stderr, flush=True)
        image = Image.open(path).convert("RGB")
        prompt = "<MORE_DETAILED_CAPTION>"
        inputs = processor(text=prompt, images=image, return_tensors="pt").to(device, torch_dtype)
        generated_ids = model.generate(
            input_ids=inputs["input_ids"], pixel_values=inputs["pixel_values"], max_new_tokens=1024, num_beams=3,
        )
        generated_text = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
        parsed = processor.post_process_generation(generated_text, task=prompt, image_size=(image.width, image.height))
        description = parsed["<MORE_DETAILED_CAPTION>"].strip()
        results.append({"file": path, "description": description})

    model.to("cpu")
    del model, processor
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    print(json.dumps(results))


if __name__ == '__main__':
    main()
