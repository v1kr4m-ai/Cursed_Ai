# Series Studio

Takes a series from an idea to finished episodes without leaving the app: discuss it with a model,
turn the discussion into a plan, render reference stills and scenes on ComfyUI, join each episode
with ffmpeg.

Open it from the **Series** tab in the sidebar.

## The flow

Subtitles from the script on a scene with a made voice (Dia/XTTS) follow the real voice, not a reading-speed guess: XTTS scenes put each speaker's words inside that speaker's turn (`voiceTurns`, turns joined with a 0.35 s gap), Dia scenes spread the lines over the voice file's length, and nothing runs past the scene length; the video prompt's sound line also drops "the person's own voice" when a made voice speaks (`withoutVoices`).

Several speakers in one talking scene (XTTS voices only): XTTS makes a scene's voice one speaker turn at a time, and now keeps each turn as its own file (`voice/<sceneId>_t<N>.wav`, recorded as `scene.voiceTurns: {speaker, file, seconds}[]`, cleared with the voice, preserved by `keepVoices`). When those turns are by 2+ different speakers, "Make talking video" queues ONE scene job that renders one S2V clip per turn with that speaker's own picture (`pickTurnPicture`) and that turn's audio, one after another (neighbouring turns of one speaker are merged into one render while they fit 14.25 s), cuts each piece to its turn + the 0.35 s join gap (the last: + the tail) and joins the pieces (`buildTalkingPieceArgs`, `buildTalkingConcatArgs`), so picture and sound stay in sync with the joined voice. A turn longer than one clip, or a speaker without a picture, is refused before queuing. Stop and keep-the-old-clip-on-failure work as for one render; only the job's own temp pieces are deleted. Dia makes one file with all speakers merged, so its turn boundaries are unknown, and a scene voiced before this change has no `voiceTurns`: both keep the old behaviour (the first speaker's picture for the whole scene), and the Voices card says so and shows the number of renders (about 3 minutes each on the 8 GB card) in the confirm text.

Talking video (optional, per scene, always a button, never automatic): once a scene has its made voice (`scene.voiceFile`), the Voices card in Produce offers "Make talking video". `talking.ts` (pure, browser-safe) picks the picture (`pickTalkingPicture`: the Person ref of the first speaker ticked in the scene, an attached photo before a made still, else the speaker's ref elsewhere in the episode, else it refuses with the reason), plans the length (`planTalking`: 77-frame chunks at 16 fps, 1 to 3, so at most 14.25 s; a longer voice is refused, never cut) and shrinks the S2V graph to that many chunks (`limitChunks`). `POST /api/series/projects/:id/scenes/:sceneId/talking` queues it like any scene render (same queue, progress, Stop, ComfyUI-not-running refusal) with the workflow "Video - Image and voice to talking video (Wan 2.2 S2V 14B)" read from ComfyUI's workflows folder (API_FORMAT copy first; never written): the voice wav goes in as the LoadAudio input, the picture (cropped to the project shape, long side 640) as the LoadImage input, the prompt is the shot plus the look. The result is cut to voice + 0.25 s with the voice normalised and saved as the scene's clip (`epNN_sceneNN.mp4`), with `scene.talking`, `scene.talkingClip` and `scene.clipBeforeTalking` (the normal clip, kept on disk). `POST .../talking/revert` ("Back to normal clip") restores it; picking another take also makes the scene normal (`isTalking` compares `clipPath` with `talkingClip`). Because that clip already carries the voice, the join does not mix the voice over it (`joinVoice`) and subtitles use the clip length. `GET /api/series/talking/status` says whether ComfyUI is up and the workflow file exists. Measured on an RTX 5060 Laptop (8 GB): about 3 minutes for a 3.8 s voice at 368x640 (one chunk); longer voices and the 14 s maximum were not timed.

XTTS voice (optional, `project.voiceEngine: "xtts"`; `usesAiVoice(project)` in `voices.ts` is true for "dia" and "xtts" and gates the Voices card, the voice mix in the join and the subtitle length): Hindi and 16 more languages with the local XTTS-v2 (`train/speech/tts/env`, model in `train/speech/models/XTTS-v2`). `xttsPlan.ts` holds the pure parts: `detectLanguage` (per line from its script: Devanagari hi, Arabic, Chinese, Japanese, Korean, Cyrillic ru, Latin en; any other script skips the scene with a reason; Hindi typed in Latin letters is read as English), `splitForXtts` (pieces under about 230 characters, fewer for Arabic/CJK), and `planTurns` (one turn per speaker change; each turn gets its speaker's `people[name].refAudio` or a built-in XTTS voice, a different one per speaker, so every speaker with a sample works, unlike Dia). The "Not English" skip rule does not apply. The same `seriesvoice` job runs `xtts_run.py` ONCE per episode (one model load, one item per turn), then ffmpeg joins each scene's turns with a 0.35 s gap into `voice/<sceneId>.wav`; mixing, the stale stamp and redo work as for Dia. When a local voice is used, `sceneFields` no longer asks the video model to say the line (it gets "Nobody speaks in this clip."); series with the video model's voice produce the same prompts as before. The Voice tab of the Audio Studio has the same engine (`POST /api/voice/xtts/start`, job `xtts`); dia, xtts and seriesvoice refuse to run at the same time.

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
