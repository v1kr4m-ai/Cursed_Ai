"""Drive the local ComfyUI instance over its HTTP API.

Two graphs are built here, both mirroring workflows that already exist in
ComfyUI\\user\\default\\workflows:

  build_sdxl_still()  -> a plain SDXL text-to-image graph, used to make the
                         reference stills that lock character identity.
  build_h3_r2v()      -> the MiniMax H3 reference-to-video graph from
                         video_minimax_h3_r2v.json, parameterised.

Usage:
    python comfy_h3.py still  <name> <prompt> [--neg ...] [--seed N]
    python comfy_h3.py video  <name> <prompt_file> <ref1.png> [ref2.png ...]
                              [--seconds 8] [--seed N]
    python comfy_h3.py status
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

# Point at a remote ComfyUI (a Colab tunnel, RunPod pod, anything) by exporting
# COMFY_SERVER. Everything else in this file is transport-agnostic.
SERVER = os.environ.get("COMFY_SERVER", "http://127.0.0.1:8188").rstrip("/")
CLIENT_ID = str(uuid.uuid4())

# Model files, as reported by /object_info on this machine.
SDXL_CKPT = "juggernautXL_ragnarokBy.safetensors"
H3_UNET = "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
H3_CLIP = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
H3_VIDEO_VAE = "minimax_h3_video_vae_fp16.safetensors"
H3_AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"


# --------------------------------------------------------------------------- api

def _request(path: str, data: bytes | None = None, headers: dict | None = None):
    req = urllib.request.Request(f"{SERVER}{path}", data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def upload_image(path: pathlib.Path, subfolder: str = "") -> str:
    """POST an image into ComfyUI's input folder. Returns the name LoadImage needs."""
    boundary = "----comfy" + uuid.uuid4().hex
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    parts = [
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="{path.name}"\r\n'
        f"Content-Type: {mime}\r\n\r\n".encode(),
        path.read_bytes(),
        b"\r\n",
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n".encode(),
    ]
    if subfolder:
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; "
            f'name="subfolder"\r\n\r\n{subfolder}\r\n'.encode()
        )
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    result = _request(
        "/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    name = result["name"]
    if result.get("subfolder"):
        name = f"{result['subfolder']}/{name}"
    return name


def queue(graph: dict) -> str:
    payload = json.dumps({"prompt": graph, "client_id": CLIENT_ID}).encode()
    try:
        result = _request("/prompt", data=payload, headers={"Content-Type": "application/json"})
    except urllib.error.HTTPError as exc:
        sys.stderr.write(exc.read().decode("utf-8", "replace") + "\n")
        raise
    return result["prompt_id"]


def wait(prompt_id: str, poll: float = 5.0, timeout: float = 43200.0) -> dict:
    """Block until the prompt leaves the queue. Returns its /history entry."""
    started = time.time()
    while time.time() - started < timeout:
        history = _request(f"/history/{prompt_id}")
        if prompt_id in history:
            return history[prompt_id]
        elapsed = int(time.time() - started)
        print(f"  ... {elapsed}s", flush=True)
        time.sleep(poll)
    raise TimeoutError(f"{prompt_id} did not finish within {timeout}s")


def outputs_of(entry: dict) -> list[dict]:
    """Flatten every image/video file record out of a history entry."""
    files = []
    for node_output in entry.get("outputs", {}).values():
        for key in ("images", "videos", "gifs"):
            files.extend(node_output.get(key, []))
    return files


def download(record: dict, dest_dir: pathlib.Path) -> pathlib.Path:
    params = urllib.parse.urlencode(
        {
            "filename": record["filename"],
            "subfolder": record.get("subfolder", ""),
            "type": record.get("type", "output"),
        }
    )
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / record["filename"]
    with urllib.request.urlopen(f"{SERVER}/view?{params}", timeout=300) as resp:
        dest.write_bytes(resp.read())
    return dest


# ------------------------------------------------------------------------ graphs

def build_sdxl_still(prompt: str, negative: str, prefix: str, seed: int,
                     width: int = 832, height: int = 1216, steps: int = 30) -> dict:
    return {
        "1": {"class_type": "CheckpointLoaderSimple",
              "inputs": {"ckpt_name": SDXL_CKPT}},
        "2": {"class_type": "CLIPTextEncode",
              "inputs": {"text": prompt, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode",
              "inputs": {"text": negative, "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage",
              "inputs": {"width": width, "height": height, "batch_size": 1}},
        "5": {"class_type": "KSampler",
              "inputs": {"seed": seed, "steps": steps, "cfg": 6.0,
                         "sampler_name": "dpmpp_2m", "scheduler": "karras",
                         "denoise": 1.0, "model": ["1", 0], "positive": ["2", 0],
                         "negative": ["3", 0], "latent_image": ["4", 0]}},
        "6": {"class_type": "VAEDecode",
              "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveImage",
              "inputs": {"filename_prefix": prefix, "images": ["6", 0]}},
    }


def snap_length(seconds: float) -> int:
    """Frame count at 24fps snapped up to the model's 17k+5 grid.

    Same expression the r2v workflow uses in its ComfyMathExpression node.
    """
    frames = max(5, round(seconds * 24))
    return frames + (5 - (frames % 17)) % 17


def build_h3_r2v(prompt: str, ref_names: list[str], prefix: str, seed: int,
                 seconds: float = 7.0, width: int = 544, height: int = 928,
                 steps: int = 20, ref_image_size: str = "match") -> dict:
    if not 1 <= len(ref_names) <= 3:
        raise ValueError("pass 1-3 reference images")

    graph = {
        "10": {"class_type": "UNETLoader",
               "inputs": {"unet_name": H3_UNET, "weight_dtype": "default"}},
        "11": {"class_type": "CLIPLoader",
               "inputs": {"clip_name": H3_CLIP, "type": "minimax", "device": "default"}},
        "12": {"class_type": "VAELoader", "inputs": {"vae_name": H3_VIDEO_VAE}},
        "13": {"class_type": "VAELoader", "inputs": {"vae_name": H3_AUDIO_VAE}},
        "20": {"class_type": "MiniMaxH3ReferenceToVideo",
               "inputs": {"clip": ["11", 0], "vae": ["12", 0], "audio_vae": ["13", 0],
                          "prompt": prompt, "width": width, "height": height,
                          "length": snap_length(seconds),
                          "ref_image_size": ref_image_size}},
        "30": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "31": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "res_multistep"}},
        "32": {"class_type": "BasicScheduler",
               "inputs": {"model": ["10", 0], "scheduler": "simple",
                          "steps": steps, "denoise": 1.0}},
        "33": {"class_type": "BasicGuider",
               "inputs": {"model": ["10", 0], "conditioning": ["20", 0]}},
        "34": {"class_type": "SamplerCustomAdvanced",
               "inputs": {"noise": ["30", 0], "guider": ["33", 0], "sampler": ["31", 0],
                          "sigmas": ["32", 0], "latent_image": ["20", 1]}},
        "40": {"class_type": "VAEDecode", "inputs": {"samples": ["34", 0], "vae": ["12", 0]}},
        "41": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["34", 0], "vae": ["13", 0]}},
        "50": {"class_type": "CreateVideo",
               "inputs": {"images": ["40", 0], "audio": ["41", 0], "fps": 24, "bit_depth": 8}},
        "51": {"class_type": "SaveVideo",
               "inputs": {"video": ["50", 0], "filename_prefix": prefix,
                          "format": "auto", "codec": "auto"}},
    }

    for index, name in enumerate(ref_names):
        node_id = str(60 + index)
        graph[node_id] = {"class_type": "LoadImage",
                          "inputs": {"image": name, "upload": "image"}}
        graph["20"]["inputs"][f"ref_images.ref_image_{index}"] = [node_id, 0]

    return graph


# -------------------------------------------------------------------------- cli

def run(graph: dict, dest: pathlib.Path, label: str) -> list[pathlib.Path]:
    started = time.time()
    prompt_id = queue(graph)
    print(f"[{label}] queued {prompt_id}", flush=True)
    entry = wait(prompt_id)
    status = entry.get("status", {})
    if status.get("status_str") == "error":
        for message in status.get("messages", []):
            print(json.dumps(message)[:2000], file=sys.stderr)
        raise RuntimeError(f"[{label}] failed")
    saved = [download(record, dest) for record in outputs_of(entry)]
    print(f"[{label}] done in {int(time.time() - started)}s -> "
          f"{[str(p) for p in saved]}", flush=True)
    return saved


NEGATIVE = ("cartoon, anime, illustration, painting, cgi, 3d render, plastic skin, "
            "text, watermark, logo, deformed hands, extra limbs, blurry, oversaturated")


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    still = sub.add_parser("still")
    still.add_argument("name")
    still.add_argument("prompt")
    still.add_argument("--neg", default=NEGATIVE)
    still.add_argument("--seed", type=int, default=1)
    still.add_argument("--width", type=int, default=832)
    still.add_argument("--height", type=int, default=1216)
    still.add_argument("--out", default="reels/pre-targaryen/refs")

    video = sub.add_parser("video")
    video.add_argument("name")
    video.add_argument("prompt_file")
    video.add_argument("refs", nargs="+")
    video.add_argument("--seconds", type=float, default=7.0)
    video.add_argument("--seed", type=int, default=42)
    video.add_argument("--width", type=int, default=544)
    video.add_argument("--height", type=int, default=928)
    video.add_argument("--steps", type=int, default=20)
    video.add_argument("--ref-size", default="match", choices=["match", "max"])
    video.add_argument("--out", default="reels/pre-targaryen/clips")

    sub.add_parser("status")

    args = parser.parse_args()

    if args.cmd == "status":
        stats = _request("/system_stats")
        device = stats["devices"][0]
        print(f"ComfyUI {stats['system']['comfyui_version']} | {device['name']} | "
              f"{device['vram_free'] / 1e9:.1f} GB free")
        queue_state = _request("/queue")
        print(f"running={len(queue_state['queue_running'])} "
              f"pending={len(queue_state['queue_pending'])}")
        return

    if args.cmd == "still":
        graph = build_sdxl_still(args.prompt, args.neg, f"reels/{args.name}",
                                 args.seed, args.width, args.height)
        run(graph, pathlib.Path(args.out), args.name)
        return

    prompt = pathlib.Path(args.prompt_file).read_text(encoding="utf-8").strip()
    names = [upload_image(pathlib.Path(ref)) for ref in args.refs]
    print(f"uploaded refs: {names}", flush=True)
    graph = build_h3_r2v(prompt, names, f"reels/{args.name}", args.seed,
                         args.seconds, args.width, args.height, args.steps,
                         args.ref_size)
    run(graph, pathlib.Path(args.out), args.name)


if __name__ == "__main__":
    main()


def _selftest() -> None:
    """Sanity checks that do not need a running server."""
    assert snap_length(5) == 124, snap_length(5)
    assert snap_length(8) == 192, snap_length(8)
    assert snap_length(10) == 243, snap_length(10)
    graph = build_h3_r2v("p", ["a.png", "b.png"], "x", 1, seconds=8.0)
    assert graph["20"]["inputs"]["length"] == 192
    assert graph["20"]["inputs"]["ref_images.ref_image_1"] == ["61", 0]
    assert graph["51"]["inputs"]["video"] == ["50", 0]
    print("selftest ok")
