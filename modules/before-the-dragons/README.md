# Before the Dragons — production handbook

A 10-episode vertical reel series on the history of the known world **before House Targaryen**, generated locally with MiniMax H3 in ComfyUI.

This file is the complete instruction set. It assumes no memory of previous sessions — hand it to any assistant (including a local model) and it can carry the work forward.

---

## 1. Machine setup

| Thing | Value |
|---|---|
| ComfyUI install | `F:\ComfyUI\ComfyUI_windows_portable` |
| Start command | `F:\ComfyUI\ComfyUI_windows_portable\run_nvidia_gpu.bat` |
| API address | `http://127.0.0.1:8188` |
| ComfyUI output dir | `F:\ComfyUI\ComfyUI_windows_portable\ComfyUI\output\reels\` |
| ComfyUI input dir (refs) | `F:\ComfyUI\ComfyUI_windows_portable\ComfyUI\input\` |
| Project | `D:\Claude\In_Progress\02_Web_Apps\Cursed_Ai\modules\before-the-dragons` |
| GPU | RTX 5060 Laptop, 8 GB VRAM |

Check the server is alive:

```bash
curl -s http://127.0.0.1:8188/system_stats
```

If that fails, start ComfyUI:

```bash
powershell -NoProfile -Command "Start-Process -FilePath 'F:\ComfyUI\ComfyUI_windows_portable\run_nvidia_gpu.bat' -WorkingDirectory 'F:\ComfyUI\ComfyUI_windows_portable'"
```

It takes about 40 seconds to answer.

### Models used

All local — no API credits, no internet needed.

- Video: `minimax_h3_ref2va_pruned_int8_convrot.safetensors`
- Text encoder: `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` (type `minimax`)
- VAEs: `minimax_h3_video_vae_fp16` (video) + `minimax_h3_audio_vae_fp32` (audio)
- Stills: `juggernautXL_ragnarokBy.safetensors` (SDXL)

H3 generates **video with audio in one pass** — narration, sound effects and music together. No separate TTS step.

---

## 2. Project layout

```
tools/
  comfy_h3.py          driver - builds graphs, queues them, downloads results
  collect.sh           copy finished renders out of ComfyUI into the project
  stitch_ep01_now.sh   concatenate Ep1's 8 clips into one reel
  run_pipeline.sh      full unattended pipeline (see WARNING in section 7)
  batch_ep0N.sh        per-episode clip batches
  refs_ep0N.sh         per-episode reference stills
reels/pre-targaryen/
  SERIES_BIBLE.md      format, episode map, generation settings
  SCRIPT_EP01-05.md    full VO script + shot list + on-screen text
  SCRIPT_EP06-10.md    same, episodes 6-10
  prompts/             ep0N_clipNN.txt - one finished H3 prompt per clip
  refs/                reference stills (character + style plates)
  clips/               finished 8-second clips, plus logs
```

---

## 3. Generation settings (do not change without reason)

| Setting | Value | Why |
|---|---|---|
| Resolution | **544×928** (0.5 MP at 9:16) | User-preferred. 768×1344 costs far more time for 2.4× the pixels |
| Length | 7 s = **175 frames** (7.29 s actual) | Snapped to the model 17k+5 grid |
| Steps | 12 | 20 was not visibly better and took longer |
| Sampler | `res_multistep` + `simple` scheduler | From the reference workflow |
| `ref_image_size` | `match` | `max` is far slower for marginal identity gain |

**Measured cost per clip: 544×928 / 7 s = 20–40 min. 768×1344 / 8 s ≈ 81–86 min.**

Episode 1 clips 2–6 are 768×1344 (a one-off, before this was measured); clips 1, 7 and 8 are smaller. Everything after is 544×928. Upscale finished clips if you need more resolution — far cheaper than generating wide.

---

## 4. Writing prompts

Every clip prompt is one text file with a reference line, then three fields:

```
Use <Picture 1> as the visual style reference for grade, lighting, haze and lens character. Use <Picture 2> as the exact appearance reference for <subject>.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, filmed in vertical 9:16 framing, <style lock>. <Shot description, camera move, action.> A narrator with a deep, gravelly, slow-paced voice and a neutral British accent (S1) says in an off-screen voiceover: <d>[English] <one VO line, 18-22 words.></d>
overall_soundscape: <1-4 sentences: ambience, physical action sounds. No dialogue, no music.>
non_diegetic_music: <1-3 sentences: instrumentation, tempo, dynamics. No mood words.>
```

Rules that matter:

- **Reference images are addressed as `<Picture 1>`..`<Picture N>` in the order they are connected.** `<Picture 1>` is always the episode's style plate.
- Narrator identity must be restated **in full in every clip** — each generation is independent and will otherwise drift to a different voice.
- The style lock must be **copied verbatim** between clips of an episode, never paraphrased.
- Camera moves take the form *type + amplitude + speed*: "pushes in with small amplitude at slow speed".
- On-screen text goes in double quotes, verbatim.
- VO should be 18–22 words — roughly 8 seconds at this narrator's pace, landing ~0.5 s before the clip ends so cuts have a clean splice point.

Full prompt spec: `SERIES_BIBLE.md` and the existing files in `prompts/`. Copy an existing one and swap the content — that is the fastest correct path.

---

## 5. Reference stills

Each episode needs a **style plate** (locks grade and lighting; used in every clip of that episode) plus one still per recurring subject.

Generate one:

```bash
python tools/comfy_h3.py still ep04_dragonlord 51 "cinematic film still, vertical composition, <subject>, <lighting>, desaturated cold color grade, photoreal, 35mm film grain" --seed 51
```

Wait — the positional arguments are `name` then `prompt`. Correct form:

```bash
python tools/comfy_h3.py still ep04_dragonlord "cinematic film still, vertical composition, ..." --neg "cartoon, cgi, text, watermark" --seed 51
```

Stills take 30–70 seconds each. **Look at every one before using it.** Failure modes seen so far:

| Asked for | Got | Fix |
|---|---|---|
| Weirwood carved face | Horror movie screaming face | Add "solemn, closed lips, wood grain"; negative "horror, screaming, teeth, glowing eyes" |
| Giant beside a mammoth | A normal man beside a mammoth | State height in metres, "with a man for scale"; negative "normal sized man" |
| Child of the forest | An actual cat | Never say "cat-like eyes"; say "large dark amber eyes"; negative "cat, fur, whiskers, muzzle" |

Budget one rerun in three.

---

## 6. Generating clips

### Preferred: queue straight into ComfyUI

The ComfyUI queue is **durable** — it survives the shell, the assistant session, everything. Jobs run one at a time in order.

```bash
cd D:/Claude/In_Progress/02_Web_Apps/Cursed_Ai/modules/before-the-dragons
python - <<'EOF'
import importlib.util, pathlib
spec = importlib.util.spec_from_file_location('m', 'tools/comfy_h3.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

refs = pathlib.Path('reels/pre-targaryen/refs')
prompts = pathlib.Path('reels/pre-targaryen/prompts')

style = m.upload_image(refs / 'ep02_style_plate_00001_.png')
wall  = m.upload_image(refs / 'ep02_wall_00001_.png')

text = (prompts / 'ep02_clip07.txt').read_text(encoding='utf-8').strip()
g = m.build_h3_r2v(text, [style, wall], 'reels/ep02_clip07', 207, 8.0, 576, 1024, 12)
print(m.queue(g))
EOF
```

Queue many at once by looping. Then collect results whenever convenient:

```bash
bash tools/collect.sh
```

### Alternative: blocking single clip

Renders one clip and downloads it into the project automatically. Ties up the terminal for ~17 minutes.

```bash
python tools/comfy_h3.py video ep02_clip07 reels/pre-targaryen/prompts/ep02_clip07.txt \
  reels/pre-targaryen/refs/ep02_style_plate_00001_.png \
  reels/pre-targaryen/refs/ep02_wall_00001_.png \
  --seconds 8 --seed 207 --steps 12 --width 576 --height 1024
```

### Monitoring

```bash
curl -s http://127.0.0.1:8188/queue | python -c "import json,sys; q=json.load(sys.stdin); print('running',len(q['queue_running']),'pending',len(q['queue_pending']))"
tail -5 "F:/ComfyUI/ComfyUI_windows_portable/ComfyUI/user/comfyui.log"
nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader
```

Cancel the running job (queued jobs stay):

```bash
curl -s -X POST http://127.0.0.1:8188/interrupt
```

Interrupt can take a minute to land — H3 only checks between sampling steps.

---

## 7. Stitching an episode

Once all 8 clips of an episode exist:

```bash
bash tools/stitch_ep01_now.sh
```

For other episodes, copy that script and change the `ep01_` prefix, the output name, and `W`/`H` to `576`/`1024`. It normalizes every input to one resolution, fps and sample rate before concatenating, which is required because the clips do not share encode parameters.

**Known issue:** each clip generates its own music independently, so the score jumps at every cut. For a polished episode, set `non_diegetic_music: N/A` in all 8 prompts and lay a single music bed over the finished reel in an editor.

---

## 8. Traps — read before automating

These all cost real time in this project:

1. **Background shells die with the session.** Anything launched as a background job belongs to the assistant's process. When it exits, the job dies mid-render. **Use the ComfyUI queue for anything long.**
2. **A detached shell has a different PATH.** `curl` and `python` may not resolve, and a wait loop will spin forever with no output because bash block-buffers stdout to a file. `run_pipeline.sh` sets an explicit PATH for this reason; it is still less reliable than queueing directly.
3. **Never `Stop-Process -Name bash`** — it kills the assistant's own shell. Never filter processes by a command line containing your own search string, for the same reason.
4. **Never `Stop-Process -Name ComfyUI`** — the portable install matches that name, so this kills the running server and every job with it.
5. **Interrupt only cancels the running job.** Pending queue entries survive; clear them via the ComfyUI web UI if you want them gone.
6. **`length` must land on the 17k+5 grid.** 192 frames = 8.00 s exactly. `snap_length()` in the driver does this; do not hand-set frame counts.
7. **Check `ffprobe` output on finished clips** — duration exactly 8.000000, expected width/height, and an `aac` audio stream. A missing audio stream means the audio VAE was not wired in.

---

## 9. Current state (2026-08-16)

**Done**
- Scripts, shot lists and VO for **all 10 episodes**
- Prompt files for **episodes 1, 2 and 3** (24 files)
- Reference stills: Ep1 complete (5), Ep2 style plate only
- Episode 1 clips **1–6 of 8** rendered

**In the ComfyUI queue right now**
- `ep01_clip07`, `ep01_clip08` at 768×1344 (~86 min each)
- `ep02_other`, `ep02_wight`, `ep02_last_hero`, `ep02_wall` stills

**Next steps in order**
1. `bash tools/collect.sh` — pull finished renders into the project
2. Review the 4 Ep2 stills; rerun any that miss (the Others is the likely one)
3. `bash tools/stitch_ep01_now.sh` — build the Episode 1 reel
4. Queue Ep2 clips 1–8 at 576×1024 using the seeds in `tools/batch_ep02.sh` (201–208)
5. Generate Ep3 stills (`tools/refs_ep03.sh`), then queue Ep3 clips (seeds 301–308)
6. Write prompt files for episodes 4–10 from `SCRIPT_EP01-05.md` / `SCRIPT_EP06-10.md`

**Reference wiring** for each queued clip is in the matching `tools/batch_ep0N.sh` — it names which still goes in which `<Picture N>` slot.
