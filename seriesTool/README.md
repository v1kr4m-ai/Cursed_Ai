# Series Studio

Takes a series from an idea to finished episodes without leaving the app: discuss it with a model,
turn the discussion into a plan, render reference stills and scenes on ComfyUI, join each episode
with ffmpeg.

Open it from the **Series** tab in the sidebar.

## The flow

Dia voice (optional, `project.voiceEngine: "dia"`, chosen in Develop's Look and voice; missing means the video model speaks as before): Produce gets a Voices card per episode that makes each scene's speech with the local Dia (English only, [S1]/[S2], about a minute per 10 s of speech, GPU). `voiceTrack.ts` holds the pure parts (script per scene from `lines`/`vo`, narrator = [S1], named speakers in order of appearance, a third speaker shares a tag with a logged note, emoji/markup stripped, scenes with non-Latin text, no speech, singing or over 30 s skipped with a reason, file names `voice/<sceneId>.wav`, older `voice/ep<N>_s<M>.wav` paths stay valid); `voiceTrackRoutes.ts` runs one background job (`seriesvoice`, refused while the Voice tab's `dia` job runs) calling `dia_run.py` once per scene and records `scene.voiceFile`/`voiceText`; `POST /api/series/projects/:id/episodes/:episodeId/voice` takes an optional `sceneId` (redo overwrites only that file). `people[name].refAudio`/`refText` is a voice sample to copy; Dia takes one sample per call, so it is used for [S1] only (the speaker who starts the scene, a sample on anyone else is not used and the scene says so). When joining (`stitch`), a clip with a voice file keeps its own sound at 20%, the voice is loudness-normalised (Dia files are very quiet) and mixed over it, and a voice longer than its clip holds the clip's last frame (voice + 0.25 s) so speech is never cut; join again after making voices.

Several voices: `project.people[name].voice` (optional, free text plus the voice chips in Develop's "People in this series") is that person's own voice; a person without one speaks with the project voice. A scene may carry `lines: {speaker?, text}[]` (dialogue, edited in Produce with "+ Add line"); `vo` stays the joined text so subtitles and word counts are unchanged. `sceneFields` (formats.ts) puts each speaker's voice in front of their line only when a line names a speaker or there are several lines; scenes without `lines` produce exactly the old prompt. The planner is told the cast and voices and may add `lines`; `vo` is still required. Pure helpers live in `voices.ts`.

Develop steps are Story, Look and voice, Episodes, Reference photos; the last step ends in a "Go to Produce" button (off until an episode is planned). Look and voice are tag lists stored as one comma-separated string (`format: "ugc,vlog"`, `voice: "on,warm"`); an old single value is a list of one. The first look tag is the main style, the rest add their camera phrase; voice has one mode (auto/off/on) plus descriptor tags. In Produce a reference card can be renamed (a person is renamed in every episode, scenes' cast, shot, line and prompt included; the picture stays) and new empty references added (`src/components/tools/series/refRename.ts`).

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
