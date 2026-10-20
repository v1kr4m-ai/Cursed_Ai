# Cursed_Ai - working notes for Claude Code

Offline-first local-LLM studio (chat, vision, memory, voice, image/video generation through ComfyUI, model hub). React 19 + Vite 6 + Tailwind 4 front end, one Express server (`server.ts`) in front of node-llama-cpp, ComfyUI, Ollama / LM Studio and the Gemini / Google APIs. Windows 11 is the primary platform. `README.md` is the user-facing description and must stay in step with the code.

## Run, check, test

| What | How |
|---|---|
| Start everything (hidden server + app window) | `Cursed_Ai.bat` (reads `.port` for the port, default 3000; closing the app window stops the server) |
| Type-check | `npm run lint` (this is `tsc --noEmit`) - must be clean before every commit |
| Unit tests | `npx vitest run` (tests live in `tests/`) |
| Server log | `app.log` in the project folder |
| Restart after server changes | `cmd //c Cursed_Ai.bat` from bash, then wait with Monitor until `curl localhost:PORT/api/health` answers (30-60 s) |

Front-end edits hot-reload (Vite). **Anything in `server.ts`, `hub.ts`, `localModels.ts`, `systemStats.ts` or `comfyTool/` needs a server restart** - there is no watcher.

## Map

```
server.ts            Express API: chat (SSE), memory, models, engine settings, config, voice, gallery, Gemini image/video, ComfyUI quick workflows, app/data/about
hub.ts               Hugging Face / Ollama / ComfyUI model search + downloads
localModels.ts       Finds models in place (download folder, LM Studio, Ollama)
systemStats.ts       CPU / RAM / GPU / VRAM / temperature for the status bar
comfyTool/           The workflow runner backend (port of the From_Prompt tool): convert.ts (UI->API workflows), titler.ts (roles, size/duration fields),
                     registry.ts, runner.ts (ComfyUI websocket), extract.ts + promptFinder.ts (prompt files: txt md csv rtf doc docx odt xlsx xlsm pptx pdf images),
                     promptDb.ts (SQLite prompt library), recentDocs.ts, google.ts (Drive / Sheets OAuth + upload), store.ts, routes.ts (all /api/tool, /api/prompts, /api/google)
src/App.tsx          Tabs, chats state (localStorage + server chats.json), settings state (persisted), toasts, shortcuts
src/components/
  chat/              ChatWindow
  voice/             VoiceAssistant (Cursed_Pirate), mic selector
  layout/            Sidebar, SystemBar, ToastHost, ProgressBar
  models/            Models tab (installed, Hugging Face, Ollama, ComfyUI)
  tools/             ExtraViews (Memory, Console, Models-dir section), EngineView, SettingsPage, VisionView, MicTest, GalleryHistory, ...
  comfy/             The Image / Video studio: StudioPage -> DirectStudio (Cloud + Quick, client queue) or WorkflowRunner (server queue), PromptSource,
                     HistoryPanel (prompt library), ShareMenu, SortMenu, google.tsx (Drive picker/connect), PreviousResults, Converter
src/lib/             notify (popups), settingsStore, studioBridge (voice -> studio), gpuInfo, modelTags, ramFit
src/services/        aiService (chat streaming), localVoice, voiceEngine, tts, attachments, errors, studioIntent (voice commands)
tests/               vitest + smoke.mjs
android/             Kotlin app (not under active work; the plan is a native client for the PC server)
```

Run-time data written next to the app (all git-ignored - never commit, never delete the user's copies): `config.json` (settings, Gemini key, engine settings), `google.json` (Google OAuth), `memory.json`, `chats.json`, `prompts.db`, `comfy-tool.json`, `comfy-tool-history.json`, `recent-documents.json`, `outputs/`, `app.log`.

## Conventions

- Match the surrounding style: Tailwind classes, the `glass` card look, lucide icons, pink = Image, orange = Video, violet = general, cyan = Engine.
- Small, real features: wire a setting all the way through (UI -> state -> server/model) or do not add it. No placeholder controls.
- Every new `/api/...` route goes in before the catch-all 404 near the end of `server.ts` (`registerComfyTool` is already before it).
- Errors the user should see go through `notifyError(message, tab)`; successes through `notify({ message, tab, thumb? })`.
- After each finished feature: update `README.md`, run `npm run lint` and `npx vitest run`, commit with a plain message ending in `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, push to `origin main` (or the area branch, see below).
- Verify in the browser (Browser pane) and/or with curl before saying it works; say plainly what was not tested.
- Test with throwaway data and clean it up (test prompts, images, chats, memory notes). Never leave test entries in the user's real library.

## Windows / tooling pitfalls (these cost time before)

- **Backslashes get eaten** in bash heredocs and inline `node -e`. For anything with regexes or `\n`/`\\`, write the script with the Write tool (or use the Edit tool on the file) and run it with `node <path>`. Use `String.fromCharCode(92)` for a backslash in generated code when needed.
- Bash `/tmp` and Node's `/tmp` are different places on Windows. Put helper scripts in the scratchpad directory and pass full `C:/...` paths to node.
- `server.ts` contains NUL bytes, so grep needs `-a`. Reading it as UTF-8 in node scripts is fine.
- Working-copy files use LF; git warns about CRLF on commit - ignore it. Some files may arrive with CRLF: normalise with `.split(String.fromCharCode(13,10)).join(String.fromCharCode(10))` before string-matching.
- The preview pane is hidden when not fronted: use `tabs_select` before screenshots; animations are throttled. Image and Video pages both stay mounted (hidden), so `document.querySelector` can hit the wrong one - scope by text or class.
- The browser pane cannot use a real microphone or drag files in from the desktop; test those through the API.
- Do not chain `sleep`; wait for a server with the Monitor tool and an `until curl ...` loop.
- Unknown `/api` routes must return 404 (they used to loop through the Vite dev proxy and exhaust sockets).

## Working on several things at once

One chat per area, each in its **own git worktree and branch** and on its **own port**, so edits and servers never collide. Create one with:

```
tools\new-area.bat <name> <port>        e.g.  tools\new-area.bat images 3001
```

It makes `..\Cursed_Ai_wt\<name>` on branch `area/<name>`, links `node_modules` from the main folder, copies `config.json`, and writes `.port`. Open Claude Code in that folder and start `Cursed_Ai.bat` there. See `docs/PARALLEL_WORK.md` for the areas, who owns which files, and how to merge.

Hot spots that several areas touch (expect conflicts, keep edits there small and merge often): `server.ts`, `src/App.tsx`, `README.md`, `package.json`, `src/types.ts`.
