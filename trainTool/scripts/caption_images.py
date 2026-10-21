"""Auto-captions every image in a folder with Florence-2, kohya-style
(`<trigger>, <detailed caption>`). Run via FluxGym's venv, which already has
this model cached locally (same recipe FluxGym's own UI uses) — offline once
that cache exists.

Usage:
    python caption_images.py --dir <dataset folder> --trigger richie01 [--overwrite]

Without --overwrite, images that already have a non-empty .txt caption are
left untouched — safe to re-run after adding new images to a folder.
"""
import argparse
import os
import sys

IMAGE_EXTS = ('.png', '.jpg', '.jpeg', '.webp')
MODEL_ID = "multimodalart/Florence-2-large-no-flash-attn"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', required=True)
    ap.add_argument('--trigger', default='')
    ap.add_argument('--overwrite', action='store_true')
    args = ap.parse_args()

    targets = []
    for name in sorted(os.listdir(args.dir)):
        if not name.lower().endswith(IMAGE_EXTS):
            continue
        img_path = os.path.join(args.dir, name)
        txt_path = os.path.splitext(img_path)[0] + '.txt'
        if not args.overwrite and os.path.exists(txt_path) and os.path.getsize(txt_path) > 0:
            continue
        targets.append((img_path, txt_path))

    if not targets:
        print("[caption] nothing to do — every image already has a caption. Use --overwrite to redo them.", flush=True)
        return

    print(f"[caption] loading Florence-2 ({MODEL_ID})…", flush=True)
    import torch
    from PIL import Image
    from transformers import AutoModelForCausalLM, AutoProcessor

    device = "cuda" if torch.cuda.is_available() else "cpu"
    torch_dtype = torch.float16 if device == "cuda" else torch.float32
    model = AutoModelForCausalLM.from_pretrained(MODEL_ID, torch_dtype=torch_dtype, trust_remote_code=True).to(device)
    processor = AutoProcessor.from_pretrained(MODEL_ID, trust_remote_code=True)

    print(f"[caption] {len(targets)} image(s) to caption on {device}", flush=True)
    for i, (img_path, txt_path) in enumerate(targets):
        print(f"[caption] {i + 1}/{len(targets)}: {os.path.basename(img_path)}", flush=True)
        image = Image.open(img_path).convert("RGB")
        prompt = "<DETAILED_CAPTION>"
        inputs = processor(text=prompt, images=image, return_tensors="pt").to(device, torch_dtype)
        generated_ids = model.generate(
            input_ids=inputs["input_ids"], pixel_values=inputs["pixel_values"], max_new_tokens=1024, num_beams=3,
        )
        generated_text = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
        parsed = processor.post_process_generation(generated_text, task=prompt, image_size=(image.width, image.height))
        caption = parsed["<DETAILED_CAPTION>"].replace("The image shows ", "").strip()
        full_caption = f"{args.trigger}, {caption}" if args.trigger else caption
        with open(txt_path, 'w', encoding='utf-8') as f:
            f.write(full_caption)
        print(f"[caption] wrote {os.path.basename(txt_path)}", flush=True)

    model.to("cpu")
    del model, processor
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    print("[caption] done.", flush=True)


if __name__ == '__main__':
    main()
