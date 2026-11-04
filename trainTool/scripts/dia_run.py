"""Generates speech with Dia (voice/dia), fully offline.

Usage: python dia_run.py <job.json>
job.json: { text, output, referenceAudio?, referenceText?, seed?, cfgScale?, temperature?, topP?, maxTokens? }
Voice cloning: Dia wants the transcript of the reference audio in front of the text, so referenceText is prepended here.
"""
import json
import os
import sys
import time

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.abspath(os.path.join(here, "..", "..", "voice", "dia"))
os.environ["HF_HOME"] = os.path.join(root, "hf")
os.environ["HF_HUB_OFFLINE"] = "1"
sys.path.insert(0, os.path.join(root, "code"))

import torch  # noqa: E402

job = json.load(open(sys.argv[1], encoding="utf-8"))
text = job["text"].strip()
ref_audio, ref_text = job.get("referenceAudio"), (job.get("referenceText") or "").strip()
if ref_audio:
    if not ref_text:
        print("[dia] warning: no transcript for the reference audio - the cloned voice will be much worse", flush=True)
    text = f"{ref_text}\n{text}" if ref_text else text
if len(text) < 80:
    print("[dia] note: very short text can ramble on until the length limit - add a sentence or two (aim for 5-20 s of speech)", flush=True)
seed = job.get("seed")
if seed is None:
    seed = int(time.time()) % 2**31
torch.manual_seed(seed)
torch.cuda.manual_seed_all(seed)

import dac  # noqa: E402
from dia.model import Dia  # noqa: E402

# the DAC codec weights are kept next to the model so nothing is downloaded
dac_file = os.path.join(root, "dac", "weights_44khz_8kbps_0.0.1.pth")
dac.utils.download = lambda *a, **k: dac_file

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
if device.type != "cuda":
    print("[dia] warning: no CUDA GPU found, running on the CPU - this will be very slow", flush=True)
t0 = time.time()
model = None
for dtype in ([job["dtype"]] if job.get("dtype") else ["bfloat16", "float16", "float32"] if device.type == "cuda" else ["float32"]):
    try:
        print(f"[dia] loading model ({dtype}) ...", flush=True)
        model = Dia.from_pretrained("nari-labs/Dia-1.6B-0626", compute_dtype=dtype, device=device)
        break
    except torch.cuda.OutOfMemoryError:
        print(f"[dia] out of GPU memory with {dtype}, trying the next precision", flush=True)
        model = None
        torch.cuda.empty_cache()
if model is None:
    sys.exit("[dia] could not load the model - not enough GPU memory")
print(f"[dia] model loaded in {time.time() - t0:.1f} s (seed {seed})", flush=True)

t1 = time.time()
print("[dia] generating ...", flush=True)
audio = model.generate(
    text,
    audio_prompt=ref_audio or None,
    max_tokens=int(job.get("maxTokens") or 3072),
    cfg_scale=float(job.get("cfgScale") or 3.0),
    temperature=float(job.get("temperature") or 1.3),
    top_p=float(job.get("topP") or 0.95),
    verbose=True,
)
if audio is None:
    sys.exit("[dia] no audio was generated")
os.makedirs(os.path.dirname(os.path.abspath(job["output"])), exist_ok=True)
model.save_audio(job["output"], audio)
peak = torch.cuda.max_memory_allocated() / 2**30 if device.type == "cuda" else 0
print(f"[dia] saved {job['output']} ({len(audio) / 44100:.1f} s of audio) - generated in {time.time() - t1:.1f} s, peak GPU memory {peak:.1f} GB", flush=True)
