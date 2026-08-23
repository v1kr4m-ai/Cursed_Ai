# Sunayna AI

Offline-first local-LLM chat app. One codebase, two runtimes:

- **Web/desktop** — React + Express server, runs GGUF models on-device via `node-llama-cpp`.
- **Android** — native app embedding llama.cpp + GGML + a Vulkan GPU backend directly in the APK (Kotlin/JNI), with the same React UI hosted in a WebView. No server, no internet connection needed at runtime.

Everything (inference, memory/RAG, voice) runs locally. An optional Gemini cloud fallback exists behind a mode switch, off by default.

## Features

- **AI Chat** — [`src/components/chat/ChatWindow.tsx`](src/components/chat/ChatWindow.tsx), streamed token-by-token via SSE from [`src/services/aiService.ts`](src/services/aiService.ts).
- **Model Manager** — [`src/components/models/ModelManager.tsx`](src/components/models/ModelManager.tsx) — browse/select local GGUF models.
- **Voice Assistant** — [`src/components/voice/VoiceAssistant.tsx`](src/components/voice/VoiceAssistant.tsx) — mic-based voice input.
- **Vector memory / RAG** — [`server.ts`](server.ts) embeds text with `Xenova/all-MiniLM-L6-v2`, stores vectors in `memory.json`, and injects the top-3 cosine-similarity matches (score > 0.5) into the prompt context.
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
| Android | Kotlin + JNI bridge to native llama.cpp/GGML, Vulkan backend, CMake/NDK build |

## Repo layout

```
src/                    React app (chat, models, voice, sidebar, tools)
components/ui/          shadcn-style UI primitives
server.ts               Express API: /api/chat (SSE), /api/memory, /api/models, /api/stats
android/                Native Android app (Kotlin + C++/JNI + Gradle)
  app/src/main/kotlin/  MainActivity, ApiServer, ModelManager, LlamaNative (JNI), ...
  app/src/main/cpp/     sunayna-local-engine.cpp, CMakeLists.txt
GGUF/                   Local model storage (gitignored — see "Getting a model" below)
```

## Prerequisites

- Node.js 20+
- For Android builds only: Android Studio, Android NDK, CMake, Git, Visual Studio Build Tools ("Desktop development with C++" workload on Windows)

## Getting a model

Model weights are **not** committed to this repo (too large for git). Download a GGUF model and drop it in `GGUF/` (or `models/` for the server to auto-detect):

```
GGUF/tinyllama-1.1b-chat-v1.0.Q2_K.gguf   # ~460MB, good for quick local testing
```

Any GGUF-format model works — e.g. TinyLlama Q4 (~600MB), Phi-3 Mini Q4 (~2.2GB), Mistral 7B Q4 (~4.1GB). Get them from [Hugging Face](https://huggingface.co/models?library=gguf).

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

1. Install Android Studio, Node.js, Git, Visual Studio Build Tools (Desktop development with C++), Android NDK, CMake.
2. `npm install && npm run build` to produce `dist/`.
3. Copy `dist/*` into `android/app/src/main/assests/www/` (embeds the frontend as the in-app WebView UI).
4. Open `android/` in Android Studio; let Gradle/NDK/CMake sync.
5. Build — compiles llama.cpp + GGML + the Vulkan backend into native `.so` libraries (`libsunayna.so`, `libllama.so`, `libggml.so`, `libvulkan_backend.so`) shipped inside the APK.
6. GGUF model files are **not** bundled in the APK — push them to the device separately (e.g. `adb push model.gguf /sdcard/Sunayna/models/`) and load from device storage at runtime.

`2. Android/build.ps1` and `2. Android/run.bat` are helper scripts for this flow.

## Known issues / recent fixes

- **Fixed**: `npm run build` previously bundled `server.ts` as CJS, but `node-llama-cpp` is ESM-only with top-level await — `npm run start` crashed immediately with `ERR_REQUIRE_ASYNC_MODULE`. Build now targets ESM (`dist/server.mjs`), matching this package's `"type": "module"`. Verified: `npm run build` and `npm run start` both work end-to-end.
- No lock around `loadModel()` — concurrent requests for two different models could interleave (only a single in-flight *inference* is guarded via `isInferenceRunning`).
- `memory.json` uses brute-force cosine similarity over all stored vectors — fine for small memory stores, will need a real vector index (e.g. HNSW) if memory grows large.
- Large main JS chunk (~734kB) — not yet code-split; fine for a local-first app, worth revisiting if bundle size becomes a concern.

## Development history

`TUTORIALS_DEV_DIARY.md` and `Roadmap.docx` document the phase-by-phase build: `sunayna_till_fake_interface` → `phase6` (vector memory) → `phase7` (llama.cpp native runtime + RAG) → `phase8` (Vulkan GPU backend) → `phase9`–`phase11`.

## Status

Working local-first chat app with a real native Android inference pipeline (llama.cpp + Vulkan compiled into the APK) — not a UI mockup.
