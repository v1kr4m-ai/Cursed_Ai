# Series Studio

Takes a series from an idea to finished episodes without leaving the app: discuss it with a model,
turn the discussion into a plan, render reference stills and scenes on ComfyUI, join each episode
with ffmpeg.

Open it from the **Series** tab in the sidebar.

## The flow

```
Dashboard          every series, with a progress bar and where its folder is
   |  start or open
Develop            idea fields + a conversation with the model (local, Ollama, LM Studio or cloud)
   |  "Build the episode plan"  -> episodes, scenes and reference stills
Produce            the board: refs and scenes, each with a status and a render button
   |  renders queue one at a time on ComfyUI, with live progress
Assemble           per-episode checklist, then join the scenes into one file
```

## Where things live

A project is a folder. Nothing is hidden in a database, so work survives the app being closed and
can be opened, copied or edited by hand.

```
series/<project-slug>/
  project.json     idea, discussion, settings, episodes, scenes, every status
  refs/            reference stills
  clips/           finished scene clips
  exports/         joined episodes
```

The projects root is `series/` next to the app's other config files.

## Settings that matter

Set these per project on the **Settings** stage before rendering:

| Setting | Notes |
|---|---|
| Scene workflow | Full path to a reference-to-video workflow saved in ComfyUI |
| Reference-still workflow | Full path to a text-to-image workflow |
| Width / Height | 544x928 is 0.5 MP at 9:16 |
| Seconds | 7 s becomes 175 frames (7.29 s) - see below |
| Steps, FPS | Written into whichever inputs the chosen workflow exposes |
| Style lock | Pasted into every scene prompt so the look does not drift between clips |
| Narrator lock | Restated in every scene, or the voice changes between clips |

Size, duration and steps are matched to the workflow by the *role* the registry works out for each
input, not by node id, so any reasonable workflow works without editing this code.

## Two things that bite

**Frame counts snap.** The model only accepts counts on a 17k+5 grid, so a requested duration
rounds up: 5 s -> 124 frames, 7 s -> 175, 8 s -> 192. `snapFrames()` does this. Note that
JavaScript's `%` keeps the sign of the dividend, which is why the normalisation in that function
looks redundant and is not - without it 7 s snaps *down* to 158 frames.

**References are positional.** A scene's reference list becomes `<Picture 1>..<Picture N>` in the
prompt, in the order shown on the scene card. The style plate should be first in every scene. A
scene cannot render until the stills it points at have been rendered; the board says which.

## Reusing the existing machinery

Generation goes through `comfyTool/runner.ts` rather than talking to ComfyUI directly, so uploads,
websocket progress, cancel and the save-to-folder step behave exactly as they do on the Image and
Video tabs. Discussion goes through `/api/chat`, so whatever the Chat tab can talk to, this can.

Jobs for one project run one at a time - ComfyUI renders serially anyway, and one queue keeps the
UI's idea of "what is running" honest.

## Tests

`npx vitest run tests/seriesTool.test.ts` covers frame snapping, prompt assembly, the ffmpeg filter
graph and pulling a plan out of a model answer.
