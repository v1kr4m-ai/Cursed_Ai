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
| **Chat** | Streaming local LLM chat, model picker, mic dictation, a **read-aloud** button on every reply, **attachments** (paperclip, **drag-and-drop onto the chat**, or **paste** an image or file: images, PDFs, DOCX, text/code files), copy / **edit-and-resend** / **regenerate** on messages, copy buttons on code blocks, a per-chat **system prompt**, export a chat as Markdown, archive/clear, live tokens/sec. Chat history is saved in the browser and survives reloads. Every launch opens a fresh chat (**New Chat** button); past chats are listed under **History** in the sidebar - search them (titles and message text), reopen with a click, rename or delete on hover |
| **Models** | Three views: **Installed** (your .gguf files, including LM Studio's publisher/repo folders, plus live **Ollama** / **LM Studio** models), **Hugging Face** (search GGUF repos, pick a quantization, download into your models folder) and **Ollama Library** (search ollama.com, pull by size). A fourth view, **ComfyUI**, searches Hugging Face for image and video models and saves them straight into ComfyUI's own models folder (checkpoints, loras, vae...), skipping any file ComfyUI already has. Each model shows a **"fits your RAM" hint** (Fits / Tight fit / Too big, from the file size and this PC's memory; the Hugging Face file list marks a **Best fit** quantization and Ollama size buttons are coloured by fit). Every model carries capability flags - Reasoning, Coding, Multilingual, Vision, Tools, Embedding - and you can filter by them. Progress bars and cancel for downloads |
| **Memory** | Your own notes ("I prefer short answers", "my project uses React"), stored as MiniLM embeddings. On each message the most relevant notes are found by cosine search and added to the prompt, for any model. Notes are added by hand; searchable, wipeable, switchable in Settings |
| **Engine** | Real telemetry (tokens/sec, RAM, active model), performance modes, unload |
| **Image** | Cloud (Gemini/Imagen) **or** local ComfyUI: txt2img and img2img with a reference image, checkpoint dropdown, size presets. Results are saved to `outputs/` and shown as a history: click to enlarge, click away to collapse, delete or open file location |
| **Video** | Cloud (Veo) **or** local ComfyUI LTX-Video (text-to-video, optional starting image); saved to `outputs/` with the same history (delete, open file location) |
| **Vision** | Pick an image, choose any installed model flagged Vision (llava, llama3.2-vision, qwen-vl... - detected from Ollama's own capability report) and ask about it |
| **Console** | Live stream of the server's real log output (sits just above Settings in the sidebar) |
| **Settings** | Sampling params, voice engine (browser vs. local Whisper), **model locations** (see below), the download folder, threads/context size |

**Cursed_Pirate, the live voice assistant** (the floating bot button, shown on every page; drag it - or the open panel by its header - anywhere, and its position is remembered): speak and your words appear live on screen; when you pause, the phrase goes to the model, the reply streams in and **is spoken sentence by sentence as it is written** (no waiting for the full answer), then it listens again. Conversation is added to the chat. If something is wrong (mic blocked, no speech reaching the browser, model error) it says so instead of failing silently.

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

Windows: run **`setup.bat`** once (checks Node, installs dependencies, puts a Cursed_Ai shortcut on your desktop), then use the shortcut or `start.bat`.

Requires Node.js 20+.

```bash
npm install
npm run dev          # http://localhost:3000   (set PORT=3100 to change)
```

On Windows you can just double-click **`start.bat`** (installs dependencies on first run, opens the browser, starts the server). It runs the current source, so you never serve a stale build.

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
hub.ts                   Model catalog: Hugging Face + Ollama + ComfyUI model search, background downloads
localModels.ts           Finds models in place: download folder, LM Studio, Ollama (manifests -> blobs), custom folders
systemStats.ts           Live CPU / RAM / GPU / VRAM / temperature readings for the status bar
tests/                   vitest unit tests + smoke.mjs (checks a running server)
start.bat / setup.bat    Windows launcher / one-time setup (installs, desktop shortcut)
android/                 Kotlin app, Ktor server, JNI bridge, vendored llama.cpp (CMake/NDK)
models/                  Default download folder for Hugging Face models (gitignored)
outputs/                 Generated images and videos (gitignored)
```

Stack: React 19, TypeScript, Vite 6, Tailwind 4 · Express · `node-llama-cpp` · `@xenova/transformers` (embeddings + Whisper) · `@google/genai` · `unpdf` + `mammoth` (PDF / DOCX text) · llama.cpp/GGML · Kotlin/Ktor.

Local image/video work by POSTing hardcoded node graphs to ComfyUI's API (`/prompt`, `/history`, `/view`) and polling for the result.

---

## Notes on honesty

This project went through an audit that removed fabricated UI (fake downloads, invented telemetry, dead buttons, canned Android responses). The rule since: no control without a real backend, no number without a real source. If something is partial, this README says so.

## Development history

`TUTORIALS_DEV_DIARY.md` and `Roadmap.docx` record the original phase-by-phase build.
