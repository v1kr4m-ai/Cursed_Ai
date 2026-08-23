# Sunayna AI

Offline-first local-LLM chat app. One codebase, two targets, both running real local inference:

- **Web/desktop** — React + Express server, runs GGUF models on-device via `node-llama-cpp`. The more mature target — also has real multi-turn history and RAG.
- **Android** — native app embedding real llama.cpp (vendored, CPU backend) via JNI, with the same React UI in a WebView. Verified loading real GGUF files and generating real tokens on-device; see [Android native engine status](#android-native-engine-status) for what's still rough (no GPU backend yet, single-turn only, no vision/speech).

An optional Gemini cloud fallback exists behind a mode switch, off by default.

## Features

- **AI Chat** — [`src/components/chat/ChatWindow.tsx`](src/components/chat/ChatWindow.tsx), streamed token-by-token via SSE from [`src/services/aiService.ts`](src/services/aiService.ts). Includes mic dictation into the input box (browser Web Speech API), clear/archive per chat, and a live tokens/sec readout computed from real stream timing.
- **Model Manager** — [`src/components/models/ModelManager.tsx`](src/components/models/ModelManager.tsx) — browse/select GGUF models; real download (streamed to `models/` with genuine byte-progress) and real delete (removes the file) for models with a known download URL.
- **Voice Assistant** — [`src/components/voice/VoiceAssistant.tsx`](src/components/voice/VoiceAssistant.tsx) — mic-based voice input/output via the browser's native SpeechRecognition/SpeechSynthesis APIs, wired to the real chat backend.
- **Vector memory / RAG** — [`server.ts`](server.ts) embeds text with `Xenova/all-MiniLM-L6-v2`, stores vectors in `memory.json`, and injects the top-3 cosine-similarity matches (score > 0.5) into the prompt context. Searchable, wipeable from the Memory tab, and toggleable per-request from Settings.
- **Engine tab** — real telemetry (tokens/sec, RAM, active model) and a performance-mode switch that actually reconfigures `node-llama-cpp`'s thread/batch count.
- **Sidebar/layout & extra tool views** — [`src/components/layout/Sidebar.tsx`](src/components/layout/Sidebar.tsx), [`src/components/tools/ExtraViews.tsx`](src/components/tools/ExtraViews.tsx).
- shadcn-style UI primitives (`components/ui/`) on Tailwind CSS 4.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS 4, `@base-ui/react`, `lucide-react`, `motion` |
| Backend (web/desktop) | Express (`server.ts`), bundled with `esbuild` for production |
| Local inference (desktop) | `node-llama-cpp` |
| Embeddings | `@xenova/transformers` (MiniLM-L6-v2) |
| Cloud fallback (optional) | `@google/genai` / `@google/generative-ai` (Gemini) |
| Android | Kotlin + JNI bridge to real vendored llama.cpp/GGML (CPU backend; Vulkan wired but off pending Vulkan SDK), CMake/NDK build |

## Repo layout

```
src/                    React app (chat, models, voice, sidebar, tools)
components/ui/          shadcn-style UI primitives
server.ts               Express API: /api/chat (SSE), /api/memory, /api/models, /api/stats
android/                Native Android app (Kotlin + C++/JNI + Gradle)
  app/src/main/kotlin/  MainActivity, ApiServer, ModelManager, LlamaNative (JNI), ...
  app/src/main/cpp/     sunayna-local-engine.cpp, CMakeLists.txt
models/                 Local GGUF model storage, read by server.ts (gitignored — see "Getting a model" below)
```

## Prerequisites

- Node.js 20+
- For Android builds only: Android Studio, Android NDK, CMake, Git, Visual Studio Build Tools ("Desktop development with C++" workload on Windows)

## Getting a model

Model weights are **not** committed to this repo (too large for git). The server only reads GGUF files from `models/` at the repo root (`GGUF/` is a leftover from an earlier build stage and isn't read by anything — ignore it).

Easiest path: open the **Models** tab in the app and click Download on Phi-3 Mini, TinyLlama, or Mistral 7B — it streams the file straight from Hugging Face into `models/` with a real progress bar. Or do it manually:

```bash
mkdir -p models
curl -L -o models/tinyllama.gguf https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
```

Any GGUF-format model works — e.g. TinyLlama Q4 (~600MB), Phi-3 Mini Q4 (~2.3GB), Mistral 7B Q4 (~4.1GB). Browse more at [Hugging Face](https://huggingface.co/models?library=gguf).

## Running as a web app

```bash
npm install
npm run dev        # tsx server.ts — Express + Vite dev server, http://localhost:3000
```

Production build:

```bash
npm run build       # vite build (frontend) + esbuild bundle of server.ts -> dist/server.mjs
npm run start        # node dist/server.mjs
```

Set `GEMINI_API_KEY` in `.env.local` only if you want the optional cloud fallback — core local inference needs no API key and no internet connection.

## Building the Android app

1. Install Android Studio, Node.js, Git, Visual Studio Build Tools (Desktop development with C++), Android NDK 26.1.10909125, CMake 3.22.1.
2. `npm install && npm run build` to produce `dist/`.
3. Copy `dist/*` into `android/app/src/main/assets/www/` (`context.assets` in `ApiServer.kt` only ever reads Android's real `assets/` source folder — an earlier, typo'd `assests/www/` folder existed alongside it for a while and was never actually packaged into the APK; it's been removed).
4. Open `android/` in Android Studio; let Gradle/NDK/CMake sync. llama.cpp is vendored directly under `android/app/src/main/cpp/llama.cpp/` (not a submodule) — no extra init step needed.
5. Build. This compiles real llama.cpp + GGML into the APK (`libggml.so`, `libllama.so`, `libsunayna-local-engine.so`) — CPU backend only for now, see Vulkan note below.
6. GGUF model files are **not** bundled in the APK. Push them to the app's own external files dir (no storage permissions needed there, unlike `/sdcard` directly, which modern Android's scoped storage blocks regular apps from reading):
   ```bash
   adb push model.gguf /sdcard/Android/data/com.sunayna.runtime/files/models/model.gguf
   ```

`2. Android/build.ps1` and `2. Android/run.bat` are helper scripts for this flow.

## Android native engine status

The native engine ([`sunayna-local-engine.cpp`](android/app/src/main/cpp/sunayna-local-engine.cpp)) is now a **real llama.cpp integration**, not the earlier stub — verified end-to-end on an emulator: real GGUF loading (correct model size/context reported from the actual file), real tokenize → decode → sample loop producing real tokens (confirmed via a monotonically-increasing real token counter in `/api/stats`, impossible to get from canned text), and real cancellation on client disconnect.

What's still rough:

- **Vulkan (GPU) backend is off**, CPU-only for now. `ggml-vulkan`'s CMake requires `find_package(SPIRV-Headers CONFIG REQUIRED)`, which needs the full LunarG Vulkan SDK on the host (the Android NDK only bundles `glslc` itself, not SPIRV-Headers/Tools). `CMakeLists.txt` has `GGML_VULKAN` forced `OFF` with the reasoning inline — flip it to `ON` once the SDK is installed; the NDK-bundled-glslc wiring in `build.gradle` is already in place.
- **Multi-turn history isn't threaded through yet** — `ApiServer.kt`'s `/api/chat` still only forwards the latest `prompt`, not the `messages` array, so each native `generate()` call is a fresh single-turn completion (the KV cache is explicitly cleared per call for exactly this reason). Real chat-history continuity needs `request.messages` wired into a prompt built via `llama_chat_apply_template`.
- **No vision or speech models are vendored** — `processImage()`/`transcribeAudio()` honestly return a "not implemented" error/empty string rather than fake output (see `MultimodalManager.kt`).
- CPU-only inference on an unaccelerated x86_64 emulator is very slow (tens of seconds per token in testing) — this is an emulator/virtualization limitation, not a code issue. A real device (native ARM silicon) or a properly hardware-accelerated emulator will be dramatically faster.
- Requires the `org.jetbrains.kotlin.plugin.serialization` Gradle plugin (now applied) — without it, every `@Serializable` response class silently fails at runtime with "Serializer for class 'X' is not found", which is a symptom worth recognizing if it resurfaces after future dependency changes.

The **web/desktop target remains the more mature one** (real multi-turn history, real RAG, verified fast) — `node-llama-cpp` genuinely loads and runs GGUF models there too.

## Known issues / recent fixes

- **Fixed**: `npm run build` previously bundled `server.ts` as CJS, but `node-llama-cpp` is ESM-only with top-level await — `npm run start` crashed immediately with `ERR_REQUIRE_ASYNC_MODULE`. Build now targets ESM (`dist/server.mjs`), matching this package's `"type": "module"`.
- **Fixed**: an unscoped `models/` rule in `.gitignore` was silently excluding `src/components/models/ModelManager.tsx` from git, breaking `npm run build` on a fresh clone. Scoped to `/models/` (repo root only).
- **Fixed**: the Models tab's "Download Weights" button was a fully simulated download (random progress, no file ever written) — replaced with a real streamed download to `models/` with genuine byte-progress, and a real delete that removes the file.
- **Fixed**: the Engine tab displayed fabricated data throughout — hardcoded "LOCAL-CLIP"/"WHISPER" pipeline status (neither exists in this codebase), a static 12ms/token latency, a static 39°C "Core Temperature" with no real sensor behind it, and hardcoded RAM-bar percentages. It also read a `stats.native.*` / `stats.performance_mode` shape that only the (stub) Android backend ever returned, so on web it silently showed placeholder dashes forever. Replaced with real backend telemetry (`/api/stats` now reports real tokens/sec, real thread/batch config, real heap-used percentage) and removed the fabricated capability claims.
- **Fixed**: several dead controls that looked functional but did nothing — the chat input's mic button, "Clear"/"Archive" buttons, the Memory tab's search box, and the Settings tab's "Inference Threads"/"KV Cache Size" sliders (previously uncontrolled, moving them updated nothing). All now wired to real state and real backend calls (`/api/mode`, `/api/engine-config`, `/api/memory` DELETE, `/api/engine/unload`).
- **Fixed**: "Semantic Memory (RAG)" and "Offline Voice Assistant" toggles in Settings previously did nothing — memory injection ran unconditionally and the Voice tab was always visible regardless of the switch. Now `memoryEnabled` actually gates RAG injection server-side, and `voiceEnabled` actually shows/hides the Voice tab.
- **Fixed**: chat image upload was captured client-side (base64-encoded, sent to the backend) but silently dropped by `server.ts`, which never read it — no vision model exists on the web target to act on it anyway. Removed the dead affordance rather than leave a button that does nothing; see the honest "Vision System Offline" messaging on the Vision tab instead.
- No lock around `loadModel()` — concurrent requests for two different models could interleave (only a single in-flight *inference* is guarded via `isInferenceRunning`).
- `memory.json` uses brute-force cosine similarity over all stored vectors — fine for small memory stores, will need a real vector index (e.g. HNSW) if memory grows large.
- Large main JS chunk (~736kB) — not yet code-split; fine for a local-first app, worth revisiting if bundle size becomes a concern.

## Development history

`TUTORIALS_DEV_DIARY.md` and `Roadmap.docx` document the phase-by-phase build: `sunayna_till_fake_interface` → `phase6` (vector memory) → `phase7` (llama.cpp native runtime + RAG) → `phase8` (Vulkan GPU backend) → `phase9`–`phase11`. Some of these phases (native Vulkan inference in particular) describe the intended end state rather than what's currently implemented — see [Known limitations](#known-limitations--android).

## Status

Web/desktop: working local-first chat app — real inference, real memory/RAG, real voice, real model management, verified end-to-end. Android: real llama.cpp inference verified on-device (CPU backend); GPU backend, multi-turn history, and vision/speech are tracked follow-up work (see [Android native engine status](#android-native-engine-status)).
