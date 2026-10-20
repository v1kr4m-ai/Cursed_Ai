# Before the Dragons — build handoff

Everything a fresh session needs to carry this work forward. Written 2026-10-20, at the point
where Episode 1 is finished and Episode 2 is rendering.

The full conversation that produced all of this is in `build-conversation-2026-10-20.zip` next to
this file, if you ever need the reasoning behind a decision rather than the decision itself.

---

## 1. What this is

A 10-episode vertical reel series on the history of the known world **before House Targaryen** —
Dawn Age through the Doom of Valyria — plus **Series Studio**, a tab inside the Cursed_Ai app that
runs the whole pipeline so the series can be produced without an AI assistant driving it.

All narration is original writing. No source text is quoted anywhere.

| | |
|---|---|
| Format | Vertical 9:16, YouTube Shorts / Reels |
| Episode | 8 scenes × ~7s ≈ 60s |
| Narration | One line per scene, 18–22 words |
| Model | MiniMax H3, running **locally** in ComfyUI (not API credits) |
| Audio | Generated with the video in one pass — narration, effects and music together |

---

## 2. Current state

**Episode 1 — "The World Before Men" — COMPLETE.**
8 clips rendered, joined to `series/before-the-dragons/exports/EP01_the_world_before_men.mp4`
(62.6s, 544×928, h264 + AAC). Note its clips are three different resolutions (576×1024, 768×1344,
544×928) from the settings changing mid-production; the stitch normalises them.

**Episode 2 — "The Long Night" — RENDERING.** All 5 references done, 8 scenes queued through the
app on 2026-10-20. Expect 20–40 min per clip.

**Episodes 3–10 — scripted, not rendered.** Full VO and shot lists exist for all of them. Episode 3
has prompt files written; 4–10 have scripts but no prompts yet. Each has a placeholder style-plate
reference that still needs a prompt and a render.

**Episode 2's references have never been tested in motion.** The stills are good, but scenes 3
(the Others) and 4 (the wight column) are the first time the video model sees them. If those clips
come out wrong, suspect the reference, not the prompt.

---

## 3. Where everything lives

```
Cursed_Ai/
  seriesTool/                     backend module
    model.ts                      Project/Episode/Scene/Ref/Source types, prompt assembly, frame snapping
    store.ts                      one folder per project, project.json is the source of truth
    ffmpeg.ts                     concat-filter join + ffprobe durations
    routes.ts                     REST + SSE; generation goes through comfyTool/runner.ts
    README.md                     settings, gotchas
  src/components/tools/series/    frontend
    SeriesStudio.tsx              shell: dashboard + stage nav + settings
    Develop.tsx                   idea, discussion, story import, plan building
    Board.tsx                     the production board (refs + scenes)
    Assemble.tsx                  per-episode checklist + ffmpeg join
    StorySources.tsx              attach stories written elsewhere
    RefDrop.tsx                   attach reference images
    chunk.ts                      chunked summarisation for long documents
    api.ts                        fetch helpers + types
  src/services/useDictation.ts    voice typing hook (offline Whisper / online browser)
  series/before-the-dragons/      THE PROJECT DATA
    project.json                  every episode, scene, status — the real state
    refs/ clips/ exports/         media
  modules/before-the-dragons/     SOURCE MATERIAL (archive)
    reels/pre-targaryen/
      SERIES_BIBLE.md             format, episode map, measured settings
      SCRIPT_EP01-05.md           full VO + shot list + text cards
      SCRIPT_EP06-10.md           same, episodes 6–10
      prompts/                    24 hand-written scene prompts (ep1–3)
      refs/ clips/                originals before migration
    tools/                        shell/python pipeline, pre-dates the app
    docs/                         this file + the conversation export
```

`project.json` is authoritative. The markdown scripts are the source the project was built from.

---

## 4. Settings, and why

| Setting | Value | Why |
|---|---|---|
| Resolution | **544×928** | 0.5 MP at 9:16. User-preferred |
| Duration | **7s → 175 frames** | Model only accepts 17k+5 frame counts |
| Steps | 12 | 20 was not visibly better |
| Sampler | `res_multistep` + `simple` | From the reference workflow |
| Cost | **20–40 min per clip** | Measured repeatedly |

768×1344 costs **~81–86 min** per clip for 2.4× the pixels — not worth it. Generate at 544×928 and
upscale if needed.

**Why references, not a LoRA:** `MiniMaxH3ReferenceToVideo` takes reference images whose tokens ride
through every sampling step — real identity conditioning. The local H3 weights are pruned int8 with
no training path, so a LoRA is not an option anyway.

**Machine:** ComfyUI portable at `F:\ComfyUI\ComfyUI_windows_portable`, port **8188**, started with
`run_nvidia_gpu.bat`. RTX 5060 Laptop, 8 GB VRAM, 31 GB RAM. The H3 weight set totals ~39.6 GB and
streams through that 8 GB card, which is why it is slow.

---

## 5. Prompt format

Each scene prompt is reference wiring, then three fields:

```
Use <Picture 1> as the visual style reference for grade, lighting, haze and lens character.
Use <Picture 2> as the exact appearance reference for <subject>.

integrated_multimodal_description: [Shot 1] <style lock> <shot> <text card>
  A <narrator lock> says in an off-screen voiceover: <d>[English] <VO line></d>
overall_soundscape: <ambience and action sounds>
non_diegetic_music: <instrumentation, tempo, dynamics — or N/A>
```

Non-negotiables:
- **References are positional** — `<Picture 1>`..`<Picture N>` in connection order. Style plate first, always.
- **Restate the narrator in every scene.** Each generation is independent; skip it and the voice changes between clips.
- **Copy the style lock verbatim** between scenes of an episode. Paraphrasing drifts the grade.
- VO at 18–22 words lands ~0.5s before the clip ends, giving a clean splice point.

---

## 6. Traps that cost real time here

1. **Background shells die with the assistant session.** Long renders belong in the ComfyUI queue or the app, not a backgrounded script.
2. **A detached shell has a different PATH.** `curl`/`python` may not resolve, and bash block-buffers stdout to a file, so a wait loop spins silently forever.
3. **Never `Stop-Process -Name bash`** — it kills the assistant's own shell. Same for filtering processes on a string your own command line contains. This happened three times.
4. **Never `Stop-Process -Name ComfyUI`** — the portable install matches that name, killing the server and every queued job.
5. **ComfyUI's queue is not durable across a server crash.** Pending jobs die with the process.
6. **JavaScript `%` keeps the sign of the dividend.** The frame-snapping formula ported from Python returned 158 frames instead of 175 — silently short clips. A test caught it; the fix has a comment, don't "simplify" it away.
7. **Image models take words literally.** "Column of corpses" produced a stone colonnade. "Cat-like eyes" produced an actual cat. "Ice queen" wording produced a ball gown. Budget one rerun in three and write negatives against the specific failure.
8. **The project folder has been renamed three times** (`Claude_ConfyUI` → `Claude_ComfyUI` → `Before_The_Dragons` → moved into `Cursed_Ai/modules/`). Each rename broke ~13 hardcoded script paths. The app reads paths from `project.json` instead, which is why it survives moves.

---

## 7. How to continue

**Run the app:** `npm run dev` in `Cursed_Ai`, open http://localhost:3000, click **Series**.
ComfyUI must be running on 8188 or renders fail; Settings shows a live green/red indicator.

**Finish Episode 2:** Produce → "Render what's missing". Then Assemble → "Join into one file".

**Start Episode 3:** its prompts exist, but the references do not. Add a style plate and the
character stills (Ghis city, legionary, slave, volcano, dragon — prompts are in
`modules/before-the-dragons/tools/refs_ep03.sh`), then render.

**Episodes 4–10:** scripts exist in `SCRIPT_EP01-05.md` / `SCRIPT_EP06-10.md`. Either paste a script
into Develop as story material and let the planner build the episode, or write prompt files by hand
following `prompts/ep01_clip01.txt`.

**Polish before publishing:** each clip generates its own music, so the score jumps at every cut.
For a finished episode, set `non_diegetic_music: N/A` on all 8 scenes and lay one bed over the
joined file in an editor.

---

## 8. App features worth knowing

- **Develop** takes story material in `txt, md, csv, Word, PDF, Excel, PowerPoint` and images (OCR). Documents over 24,000 chars are summarised chunk by chunk, once, and the digest is saved.
- **Voice typing** in the Develop composer: offline Whisper or the online browser recognizer, auto-switching if the network drops.
- **Reference images** can be dropped, pasted or picked — used as-is, no generation needed.
- **The plan button** needs any one of: a logline, an attached story, or a conversation.
- **Generation is queued one job at a time per project**, with live progress over SSE.

**Tests:** `npx vitest run` — 51 passing, 20 of them covering this module (frame snapping, prompt
assembly, the ffmpeg filter graph, plan extraction, chunking).
