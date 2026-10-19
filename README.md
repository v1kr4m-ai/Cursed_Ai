# Cursed_Ai

**A private, offline-first AI studio.** Chat with large language models running on your own machine, give them long-term memory, talk to them by voice, and generate images and video — locally through [ComfyUI](https://github.com/comfyanonymous/ComfyUI), or via the cloud when you choose to.

One React UI, two runtimes:

| Target | How it runs | Maturity |
|---|---|---|
| **Web / Desktop** | React frontend + Express server, GGUF models via `node-llama-cpp` | Main target, most complete |
| **Android** | Kotlin app, WebView UI, embedded Ktor server, vendored **llama.cpp** via JNI | Real inference works; fewer features |

Nothing is mocked: every control in the UI talks to a real backend, and anything that isn't built yet says so instead of faking it.

---

## Features

| Tab | What it does |
|---|---|
| **Chat** | Streaming local LLM chat, model picker, mic dictation, a **read-aloud** button on every reply, **attachments** (paperclip, **drag-and-drop onto the chat**, or **paste** an image or file: images, PDFs, DOCX, text/code files), copy / **edit-and-resend** / **regenerate** on messages, copy buttons on code blocks, a per-chat **system prompt**, export a chat as Markdown, archive/clear, live tokens/sec. Chat history is saved in the browser **and** in `chats.json` next to the app (gitignored), so it follows you between the app window, a browser tab and restarts - the two copies are merged by chat id, newest wins. Every launch opens a fresh chat (**New Chat** button); past chats are listed under **History** in the sidebar - grouped as **Pinned / Today / Yesterday / Previous 7 days / Older**; search them (titles and message text), reopen with a click, **pin**, rename or delete on hover |
| **Models** | Three views: **Installed** (your .gguf files, including LM Studio's publisher/repo folders, plus live **Ollama** / **LM Studio** models), **Hugging Face** (search GGUF repos, pick a quantization, download into your models folder) and **Ollama Library** (search ollama.com, pull by size). A fourth view, **ComfyUI**, searches Hugging Face for image and video models and saves them straight into ComfyUI's own models folder (checkpoints, loras, vae...), skipping any file ComfyUI already has. Each model shows a **"fits your RAM" hint** (Fits / Tight fit / Too big, from the file size and this PC's memory; the Hugging Face file list marks a **Best fit** quantization and Ollama size buttons are coloured by fit). Every model carries capability flags - Reasoning, Coding, Multilingual, Vision, Tools, Embedding - and you can filter by them. Progress bars and cancel for downloads, and **interrupted Hugging Face downloads resume** where they stopped (cancel, an error or a restart keeps the partial file; starting the same download again continues it) |
| **Memory** | Your own notes ("I prefer short answers", "my project uses React"), stored as MiniLM embeddings. On each message the most relevant notes are found by cosine search and added to the prompt, for any model. Notes are added by hand; searchable, **editable (pencil) and deletable one by one (bin icon)** - an edited note is embedded again so retrieval follows the new wording - **exportable and importable as a JSON file** (import skips duplicates and re-embeds) - wipeable all at once, switchable in Settings |
| **Engine** | A redesigned dashboard for how local models run: live speed, loaded model (layers on GPU, context), tokens and app memory; performance profiles; and real settings that are applied to llama.cpp and kept in `config.json` - **GPU offload** (CPU only / Auto / All / a custom layer count), **CPU threads**, **batch size**, **context size**, **flash attention**, **memory-map** and **lock in RAM**, and **keep-alive** (unload the model after N idle minutes to free memory). Shows the detected GPU backend and device, cores and RAM; unload now, reset to defaults, wipe the memory store. GPU / memory-map / lock changes reload the model on the next message, the rest apply at once. **Startup & services:** load the last model when the app starts, start ComfyUI at launch, and the **ComfyUI address** (another port or PC) |
| **Image** | Cloud (Gemini/Imagen) **or** local ComfyUI: txt2img and img2img with a reference image, checkpoint dropdown, size presets - or switch Local to **Workflows** to run your own saved ComfyUI workflows (see below). Results are saved to `outputs/` and shown as a history: click to enlarge, click away to collapse, delete or open file location |
| **Video** | Cloud (Veo) **or** local ComfyUI LTX-Video (text-to-video, optional starting image), or Local -> **Workflows** for your own video workflows; saved to `outputs/` with the same history (delete, open file location) |
| **Vision** | Pick an image, choose any installed model flagged Vision (llava, llama3.2-vision, qwen-vl... - detected from Ollama's own capability report) and ask about it. **Keep the conversation going**: ask follow-ups about the same image, then **Continue in Chat** moves the whole exchange (image included) into a new chat so you can carry on there |
| **Console** | Live stream of the server's real log output (sits just above Settings in the sidebar) |
| **Settings** | Everything you change is **remembered** (browser storage). **Generation:** temperature, Top P, max tokens plus **Top K, Min P, repeat penalty and a fixed or random seed** (applied to local models and to Ollama / LM Studio). **Chat:** a **default system prompt** for new chats, **Enter or Ctrl+Enter to send**, **read replies aloud automatically**, ask before deleting a chat. **Voice engine**, **model locations** and the download folder, **interface size** and **reduce motion**, **popups** on/off and **Windows notifications** for background work. **Data & storage:** what the app keeps and how big it is, open the data folder, **export / import chats**, delete all chats |

**Cursed_Pirate, the live voice assistant** (the floating bot button, shown on every page; drag it - or the open panel by its header - anywhere, and its position is remembered): speak and your words appear live on screen; when you pause, the phrase goes to the model, the reply streams in and **is spoken sentence by sentence as it is written** (no waiting for the full answer), then it listens again. Conversation is added to the chat. If something is wrong (mic blocked, no speech reaching the browser, model error) it says so instead of failing silently.

**Quick image advanced settings:** Local -> Quick image has an Advanced section with **steps**, **CFG** and an optional **fixed seed** (same seed and settings give the same picture). Turbo / Lightning / LCM checkpoints switch to 4 steps and CFG 1.5 automatically. The values are saved with the prompt in the library.

**Quick video duration:** Local -> Quick video has a Duration box (1-20 s, shown as frames at 25 fps, rounded to what LTX-Video needs) next to the size; the length is saved with the prompt in the library.

**Recent documents:** every document the prompt box reads (a local file, a Drive file or a link) is remembered in `recent-documents.json` (gitignored) together with the prompts found in it. A small **Recent** row under the Prompt heading reopens one with a click (hover to forget it), and the newest document's prompt list is restored automatically the next time the page opens.

**Google Drive / Sheets / Docs:** the Prompt section has a cloud button (pick any Drive file - Sheets, Docs, Slides, xlsx, docx, pdf, txt, images - from a browsable, searchable list) and a link button (paste a Sheets / Docs / Slides / Drive link; files shared "anyone with the link" work without signing in). Sheets, Docs and Slides are read through their xlsx / docx / pptx export, so the same prompt dropdown, column switching and Run all apply. The **cloud-upload icon** in the top bar connects your Google account and can **save every result to Drive automatically** (in a `Cursed_Ai` folder it creates, or any folder you pick); uploaded results show an "on Drive" link in the library and a popup announces each upload. Setup is once and uses your own Google Cloud project (create an OAuth client of type Desktop app with the Drive API enabled and paste the client ID and secret); credentials and tokens stay in `google.json` (gitignored), nothing is shared. Alternatively save into a Google Drive for desktop folder with the normal Save-to picker.

**Prompt library (History):** every prompt that makes an image or video is saved in `prompts.db` (SQLite, gitignored) with its picture, mode (Cloud / Quick / Workflow), workflow, size and duration. **History -> Prompts** lets you search (prompt, negative prompt, notes, tags, workflow), sort (the arrows icon: newest, oldest, A-Z, favourites first), show favourites only, **star**, **edit** (prompt, negative prompt, notes, tags), copy, remove the entry (the file stays) and press **Use** to put the prompt back - for workflows the workflow and its settings come back too. **Files** shows the raw output files. Results from before the library existed are imported from the workflow history.

**Size, duration, references and instances (Workflows):** the Size & duration section shows the picture size (presets or custom width / height, swap) and, for video, duration in seconds with frames and fps kept in step (rounded to what the model needs, e.g. 8n+1 for LTX). Reference slots show **required** or **optional** with a **Bypass** checkbox for the optional ones, as in the original From_Prompt tool. The workflow list has a phone-style sort icon (name, recently used, ready first, fewest references) with search inside it. The number box next to Generate runs it several times with a new seed each (also in Cloud and Quick); Generate stays available while a job runs, so you can keep adding to the queue.

**Share:** a Share button beside every result opens the Windows share sheet (attaches the file: WhatsApp, Telegram, Mail, Quick Share / Nearby Share, whatever is installed), copies an image to the clipboard, or opens WhatsApp, Telegram, email, X, Instagram, YouTube or YouTube Shorts - those sites cannot be handed a file, so the file is selected in Explorer ready to drag in.

**Desktop app mode:** `Cursed_Ai.bat` starts everything with no console window and opens the app in its own window; popups with a thumbnail announce every finished or failed image / video, also for jobs that finish in the background.

**One studio layout for every mode (Image and Video):** Cloud, Local -> Quick and Local -> Workflows share the same screen - a slim top bar (Cloud / Local, Quick / Workflows, **History**, Gemini key or ComfyUI status), collapsible controls on the left with Generate pinned at the bottom, and on the right a large canvas, the **Queue** (always visible, with pause / resume / cancel icons - Cloud and Quick jobs wait in a queue that runs one at a time) and a Recent strip. **History** swaps the canvas for everything generated so far (click to enlarge, delete, open location). **Prompt from a file works in all modes:** the Prompt section has an open-file button for `.txt .md .csv .tsv .rtf .doc .docx .docm .odt .xlsx .xlsm .pptx .pptm .pdf` (and images via OCR); spreadsheets list every prompt (column guessed and switchable) in a searchable dropdown, documents and slides list each "Prompt" heading, you pick one into the box, or **Run all N** queues them all (old `.xls` must be saved as `.xlsx`/`.csv`).

**Workflow runner (Image and Video, local only):** in Local (ComfyUI) mode the page becomes a full-height studio - a slim top bar (Cloud / Local, Quick / Workflows, ComfyUI status), collapsible control sections on the left (Workflow, Prompt, References, Settings, Output, Tools) with Generate always visible, and a large canvas on the right for live preview, the result and a Recent filmstrip. In Local (ComfyUI) mode - now the default, with Cloud second - a **Quick | Workflows** switch (remembered per tab) opens a runner for your own saved ComfyUI workflows. Image shows the image workflows, Video the video ones; Cloud and Quick are unchanged. Pick the folder where ComfyUI keeps your `.json` workflows; UI-format files are converted on the fly through ComfyUI's node list (so ComfyUI must be running), API-format files run as they are. The app works out the prompt node, the output node, reference-image/video/audio slots (optional ones can be skipped) and the main settings (steps, size, seed...) for each workflow, and says plainly why one cannot run (missing custom nodes, no output node); if it cannot decide the prompt or output node you pick it once and it is remembered. **Prompt from a file:** drop or choose a `.txt`, `.md`, `.docx`, `.xlsx`, `.pdf` (or an image, read by OCR if Tesseract is installed) and the text after a "Prompt" marker is pulled out; spreadsheets list every prompt (column guessed, switchable) in a searchable dropdown, and **Run all N** queues every prompt in the file with the current settings (ComfyUI works through them in order; they appear under Running jobs and in Recent results); the text stays editable. Runs get a fresh seed each time (switchable), show live step progress and previews, can be cancelled (also inside ComfyUI), are saved under a name you choose or an automatic one to the folder you choose (default `outputs/`, so they also appear in the History gallery), and are listed under "Recent workflow results" with delete, show in folder, **reuse prompt** and (for images) **use as reference image**. **Saved setups:** "Save current" stores the workflow, prompt, settings, reference picks and destination under a name (kept in this browser, per tab); pick it from the list to restore everything in one click. **Reference media uses the normal Windows file dialog** ("Choose files" - multi-select, the files are used where they are, no copy); every folder button in the app (workflows, library, save-to, models locations, ComfyUI folder) opens the Windows folder dialog; the in-app browser is only a fallback where that is unavailable. **Reference files can also be dropped straight onto the Reference media card** (saved into the reference folder, or `outputs/references` if none is set) and fill the first free slot of their type. Settings live in `comfy-tool.json` and `comfy-tool-history.json` (gitignored). Not ported from the original standalone tool: Projects and the separate Queue page (running jobs are listed inline); the batch folder converter is a collapsible panel at the bottom of the runner.

**Enhance prompt:** a sparkle button beside every Image and Video prompt box (Cloud, Quick and Workflows) rewrites a short idea into a detailed generation prompt using the chat model that is currently selected - fully local, one click to stop, and an undo arrow restores what you typed.

**Gemini key (cloud image / video):** in Cloud mode a small **key icon** sits beside the Cloud / Local toggle - amber with a pulsing dot while no key is set. Click it, paste your key into the password field (shown as dots; the eye icon reveals it) and save; it is stored in `config.json` (gitignored), never sent back to the browser, and can be removed with the bin icon. A `GEMINI_API_KEY` environment variable still works and takes precedence.

**Job queue controls:** the **Jobs** list in the workflow runner has icons per job: **pause** (a job still waiting is taken out of ComfyUI's queue and kept; ComfyUI cannot pause one that is already generating), **cancel** (also stops a running job inside ComfyUI), and for paused jobs **resume** (goes to the end of the queue) or remove.

**Look and feel:** compact type by default, with **Settings -> Appearance -> Interface size** (Small / Default / Large) that scales text, buttons and spacing everywhere; the message bar is slim, glows when you focus it, slides in, and the send button pops when there is something to send.

**Voice settings and shortcuts:** Settings -> Voice lets you pick the speaking voice (any voice installed on the PC, so it works offline) and its speed, with a Test button; it applies to the read-aloud button and the assistant. Shortcuts: **Ctrl+K** new chat, **Ctrl+/** jump to the message box.

**Live status bar:** small pills at the top right of every page show real-time CPU, RAM, GPU, VRAM and temperature (GPU and VRAM follow whichever graphics chip is busiest - the NVIDIA chip via `nvidia-smi`, and any other adapter, such as a laptop's integrated GPU, via Windows' GPU counters, with its shared memory; Windows offers no CPU temperature without extra tools, so Temp is the NVIDIA GPU's). **Popups** announce a finished image, video or (when you are on another page or tab) chat reply, and **errors and warnings pop up too** (red / amber, shown longer) in addition to the message on the page; clicking one opens the right page; Image and Video pages stay alive in the background so a running job still reports.

**Progress bars:** image and video generation show real sampler progress from ComfyUI ("Step 12 of 20"), chat shows tokens written, Vision and cloud jobs show a moving bar, and model downloads show bytes and percent. The Cursed_Pirate window minimises when you click anywhere else; End stops the conversation.

**Stop buttons and errors:** every long job can be stopped - chat (Stop button or Esc), image generation (also cancels the job inside ComfyUI), video generation, model downloads, Vision. A red banner appears if the local server stops answering, Models explains when Ollama / LM Studio are off, and failures show plain-language messages with the next step.

Voice works **in every browser and fully offline**: the browser's live recognizer is used when it exists and you are online (Chrome/Edge); otherwise - Firefox, Safari without speech support, or no internet - the app switches by itself to the local Whisper model, which listens until you stop talking, transcribes on this PC and carries on hands-free. Chat dictation only **types into the text box - nothing is sent until you press Send** - while the Cursed_Pirate assistant **sends what it heard by itself as soon as you stop or pause** and speaks the answer. Both do this (Settings -> Voice Engine: Auto / Browser / Offline); offline you see the microphone level, the stage (Waiting / Hearing / Transcribing) and live captions while you talk, and Settings has a **Microphone test**. Online it goes back to the browser's live recognizer by itself. **The microphone type is chosen from the mic button itself** (chat) or the selector beside Start (assistant): a small menu pops out of the mic, folds back into it when you pick or click elsewhere, and the mic's colour and badge show the choice - blue globe = online browser mic, green = offline Whisper, violet = automatic. Switching mid-conversation takes effect immediately; the choice is remembered. The microphone itself needs `localhost` or HTTPS.

Voice has two engines: the browser's Web Speech API (fast, not fully offline) or **local Whisper** (transformers.js, fully offline, on-device).

---

## Current status

**Verified working**
- Web chat (with saved history and scrolling), live voice assistant (browser engine, tested with the real microphone), memory/RAG, engine controls, console, local Whisper transcription.
- **Models tab, end to end:** search Hugging Face, download a GGUF (progress + cancel), then chat with it through the built-in llama.cpp engine; search the Ollama library and pull a model through the Ollama app; capability flags and flag filters; nested LM Studio-style folders are found.
- **Attachments:** PDF and text files read and answered correctly; images reach vision models in Ollama (`llava` answered a colour question correctly).
- Local ComfyUI **image** (txt2img + img2img) and **video** (LTX-Video text-to-video, mp4) — all tested end-to-end against a real ComfyUI, including the saved-history gallery and a "generated" popup. A "Start ComfyUI" button launches it from a folder you choose (checks first; does nothing if already running).
- **Offline microphone:** the local Whisper model transcribes a recorded sentence correctly, with live captions, hands-free turns and the level / stage display, in a browser without any speech recognition. Switching between the online and offline mic - from the mic button's own menu - works mid-conversation. (Tested with recorded audio; the in-app browser cannot reach a real microphone.)
- **Status bar, popups, progress and stop buttons:** real CPU / RAM / GPU readings, success / warning / error popups, ComfyUI "Step n of 20" progress, and stopping chat, image and video jobs (ComfyUI is told to cancel too).
- **GPU:** the built-in engine runs on the GPU through Vulkan (about 3x faster than CPU on the test PC). A CUDA build was not available for an RTX 50-series card.
- **Chat conveniences:** drag-and-drop and paste attach files, Ctrl+K / Ctrl+/ shortcuts, regenerate / edit-and-resend, system prompts, history search / rename / delete (checked in the browser).
- Android: real llama.cpp loading a real GGUF and generating tokens on-device (emulator-tested).

**Written but not yet run end-to-end**
- Cloud image/video (Gemini/Imagen/Veo): error handling verified, real generation needs your `GEMINI_API_KEY`.

**Known gaps**
- The speaking-voice picker (Settings -> Voice) was not heard end to end: the test browser lists no installed voices. It uses the voices of your own browser and PC.
- Real-microphone voice (online and offline) is not verified on every machine: if it cannot hear you, open Settings -> Voice -> Microphone test, and make sure you are in a normal browser at `http://localhost:3000` (the Claude desktop app's built-in browser blocks the microphone).
- Hugging Face's search API was down during one round of testing, so the ComfyUI model search itself has not been seen returning results (downloads and the duplicate guard were tested).
- The Ollama Library view reads ollama.com's search page (the site has no public search API), so a redesign of that page could break it. Hugging Face uses its documented API.
- Capability flags are best-effort guesses from model names, Ollama's labels and Hugging Face tags; some will be wrong.
- Hugging Face downloads support single-file GGUFs only (split `-0000N-of-0000M` files are listed but disabled) and gated repos need an `HF_TOKEN`.
- Images in chat only work with vision models served by Ollama or LM Studio; local `.gguf` chat ignores them. Scanned PDFs are not OCR'd.
- **Android parity**: the Android backend (Kotlin) does not have the newer endpoints (console, image, video, Whisper, models-folder config) — those tabs fail cleanly there until mirrored.
- **Android inference** is CPU-only (Vulkan is wired but off; needs the Vulkan SDK), single-turn (no chat history threaded to the native layer yet), no vision/speech models.
- Tests: `npm test` (unit tests for model flags, RAM-fit, error messages, voice-engine choice and model-folder scanning) and `npm run smoke` (checks a running server's main endpoints). The browser screens themselves are still checked by hand.
- Single large JS bundle (~770 kB), not code-split.

---

## Quick start (web)

Windows: run **`setup.bat`** once (checks Node, installs dependencies, puts a Cursed_Ai shortcut on your desktop), then use the shortcut or `Cursed_Ai.bat`.

Requires Node.js 20+.

```bash
npm install
npm run dev          # http://localhost:3000   (set PORT=3100 to change)
```

On Windows just double-click **`Cursed_Ai.bat`**: it starts the server with no console window (installing dependencies on first run) and opens Cursed_Ai in its own app window (Edge or Chrome app mode, no tabs or address bar). Closing the window stops the server; messages go to `app.log`. It runs the current source, so you never serve a stale build.

Production build (rebuild after every code change, or `npm run start` serves old code):

```bash
npm run build        # vite build + esbuild bundle of server.ts → dist/
npm run start
```

### Attachments
Click the paperclip next to the chat box. Text, code, PDF and DOCX files are read on the server and sent to the model as text (first ~10,000 characters, to fit the context window). Images are downscaled and sent to **vision models served by Ollama or LM Studio** (e.g. `llava`, `llama3.2-vision`); local `.gguf` models ignore images. Scanned PDFs have no text layer and are not OCR'd.

### One copy of every model
Cursed_Ai does not keep its own private model store. **Settings -> Storage -> Model locations** lists the folders it reads models from, each with an on/off switch and a count: the download folder, **LM Studio's** folder, **Ollama's** folder (found automatically, even when you moved it with `OLLAMA_MODELS` or the Ollama app setting) and any folders you add. Models are run straight from there - for Ollama, the model blob in its own folder is loaded directly, no copy and no need for Ollama to be running - and a file reachable through several folders (LM Studio often holds links to Ollama's blobs) is listed once. These folders are read-only: delete a model in the app that owns it. Hugging Face downloads go to the **download folder** you choose (pick LM Studio's to share with it) and are refused if you already have the same file anywhere.

### Get a model
The server reads `.gguf` files from `models/` (or any folder you pick in **Settings → Storage → Browse**). Either click Download in the **Models** tab, or point Settings at a folder you already have.

### Optional integrations
| Feature | Needs |
|---|---|
| Cloud image/video | `GEMINI_API_KEY` in `.env.local` + internet |
| Local image/video | ComfyUI running at `http://127.0.0.1:8188` (override with `COMFYUI_URL`); video needs an LTX-Video checkpoint + a T5-XXL text encoder (core nodes only, no custom packs). Set your ComfyUI folder (portable build) with the button in the Image/Video tabs |
| Gemini chat fallback | `GEMINI_API_KEY` |
| Ollama models | Ollama running on `localhost:11434`; chats use a 4096-token context so large models fit in RAM |
| Live voice (browser engine) | Chrome or Edge, microphone permission, internet (the browser's speech service). Use Local Whisper in Settings for fully offline |

---

## Building the Android app

1. Install Android Studio, NDK `26.1.10909125`, CMake `3.22.1`, JDK 17.
2. `npm install && npm run build`, then copy `dist/*` into `android/app/src/main/assets/www/`.
3. Build from `android/` (`./gradlew :app:assembleDebug`) or open it in Android Studio. llama.cpp is vendored under `android/app/src/main/cpp/llama.cpp/` — no submodule step.
4. Push a GGUF to the app's own storage (no permissions needed):
   ```bash
   adb push model.gguf /sdcard/Android/data/com.cursed.runtime/files/models/model.gguf
   ```

CPU inference on an unaccelerated emulator is very slow (tens of seconds per token); a real ARM phone is far faster.

---

## Architecture

```
src/                     React app (chat, models, voice, memory, engine, console, image, video, vision, settings)
  components/            chat, models (cards, hub, flags), voice (assistant, mic selector), layout (sidebar, status bar, popups, progress)
  lib/                   modelTags (capability flags), ramFit (will it fit?), notify (popups), gpuInfo
  services/              aiService (chat streaming), localVoice (offline mic), voiceEngine (online/offline choice), tts (voice + speed), attachments, errors
components/ui/           shadcn-style primitives
server.ts                Express API: chat (SSE), memory, models, engine, config, console, voice,
                         image/video (Gemini + ComfyUI, with live progress), attachments, filesystem browse
comfyTool/               Workflow runner: workflow converter, titler/registry, prompt-file reader, runner (ComfyUI websocket), store, routes
hub.ts                   Model catalog: Hugging Face + Ollama + ComfyUI model search, background downloads
localModels.ts           Finds models in place: download folder, LM Studio, Ollama (manifests -> blobs), custom folders
systemStats.ts           Live CPU / RAM / GPU / VRAM / temperature readings for the status bar
tests/                   vitest unit tests + smoke.mjs (checks a running server)
Cursed_Ai.bat / setup.bat  Windows launcher (hidden, app window) / one-time setup (installs, desktop shortcut)
android/                 Kotlin app, Ktor server, JNI bridge, vendored llama.cpp (CMake/NDK)
models/                  Default download folder for Hugging Face models (gitignored)
outputs/                 Generated images and videos (gitignored)
```

Stack: React 19, TypeScript, Vite 6, Tailwind 4 · Express · `node-llama-cpp` · `@xenova/transformers` (embeddings + Whisper) · `@google/genai` · `unpdf` + `mammoth` (PDF / DOCX text) · llama.cpp/GGML · Kotlin/Ktor.

Local image/video quick mode works by POSTing hardcoded node graphs to ComfyUI's API (`/prompt`, `/history`, `/view`) and polling for the result.

---

## Notes on honesty

This project went through an audit that removed fabricated UI (fake downloads, invented telemetry, dead buttons, canned Android responses). The rule since: no control without a real backend, no number without a real source. If something is partial, this README says so.

## Development history

`TUTORIALS_DEV_DIARY.md` and `Roadmap.docx` record the original phase-by-phase build.
