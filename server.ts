import { registerHub, modelDirs } from "./hub";
import { createLocalModels, shortHash } from "./localModels";
import { registerSystemStats } from "./systemStats";
import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { spawn } from "child_process";
import { createServer as createViteServer } from "vite";
import { getLlama, LlamaChatSession } from "node-llama-cpp";
import { pipeline } from "@xenova/transformers";
import { GoogleGenAI } from "@google/genai";

type PerformanceMode = "BATTERY_SAVER" | "BALANCED" | "PERFORMANCE";

const PERFORMANCE_PROFILES: Record<PerformanceMode, { threads: number; batchSize: number }> = {
  BATTERY_SAVER: { threads: 2, batchSize: 128 },
  BALANCED: { threads: 4, batchSize: 256 },
  PERFORMANCE: { threads: 8, batchSize: 512 },
};

function getLocalNetworkAddress(): string {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Default express.json() limit is 100kb - too small for base64-encoded
  // reference/source images (image generation, ComfyUI img2img/SVD), which
  // routinely run several MB. Without this, oversized requests get rejected
  // before reaching any route handler and the client sees Express's default
  // HTML error page instead of a JSON error.
  app.use(express.json({ limit: "50mb" }));

  // --- Console log capture: real ring buffer + SSE, backs the Console tab.
  // Every console.log/info/warn/error call in this process (including the
  // ones already scattered through this file) gets mirrored here.
  const MAX_LOG_LINES = 500;
  const logBuffer: { id: number; level: string; message: string; timestamp: number }[] = [];
  let logIdCounter = 0;
  const logSubscribers = new Set<express.Response>();

  function formatLogArg(a: any): string {
    if (typeof a === "string") return a;
    // Error objects need special handling: their message/stack aren't
    // enumerable own properties, so JSON.stringify(error) is always "{}".
    if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  }

  function pushLog(level: "log" | "info" | "warn" | "error", args: any[]) {
    const message = args.map(formatLogArg).join(" ");
    const entry = { id: ++logIdCounter, level, message, timestamp: Date.now() };
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
    for (const res of logSubscribers) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }
  }

  const originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  (["log", "info", "warn", "error"] as const).forEach(level => {
    console[level] = (...args: any[]) => {
      originalConsole[level](...args);
      pushLog(level, args);
    };
  });

  let llama: any = null;
  let modelInstance: any = null;
  let context: any = null;
  let session: any = null;
  let activeModelName: string | null = null;
  let isInferenceRunning = false;
  let performanceMode: PerformanceMode = "BALANCED";
  let userThreads: number | undefined;
  let userContextSize: number | undefined;

  // Real telemetry from the last / current generation (replaces the fabricated
  // "native" stats the UI used to expect from a mobile-only backend).
  let lastGenerationTps = 0;
  let totalTokensGenerated = 0;

  // Embedding Pipeline
  let embedder: any = null;
  const MEMORY_FILE = path.join(process.cwd(), "memory.json");
  let memoryStore: { text: string; vector: number[]; timestamp: number }[] = [];

  // Load persistence
  if (fs.existsSync(MEMORY_FILE)) {
    try {
      memoryStore = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
      console.log(`[Memory] Loaded ${memoryStore.length} entries from disk.`);
    } catch (e) {
      console.error("[Memory] Failed to load memory file", e);
    }
  }

  function saveMemory() {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memoryStore, null, 2));
  }

  // Single-flight guards: two requests arriving before the first model
  // finishes loading must await the SAME promise, not each start their own
  // pipeline() call — transformers.js writes the downloaded model files to
  // a shared on-disk cache, and two concurrent first-loads racing to write
  // the same cache files corrupts them (this was a real, reproduced bug —
  // "Unsupported model type: whisper" from a torn config.json/onnx file).
  let embedderPromise: Promise<any> | null = null;
  async function ensureEmbedder() {
    if (!embedderPromise) {
      console.log("[Memory] Loading embedding model (MiniLM-L6-v2)...");
      embedderPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    }
    return embedderPromise;
  }

  // Local offline speech-to-text (Whisper via transformers.js — runs
  // on-device in this Node process, no audio ever leaves the machine).
  let transcriberPromise: Promise<any> | null = null;
  async function ensureTranscriber() {
    if (!transcriberPromise) {
      console.log("[Voice] Loading local Whisper model (whisper-tiny.en)...");
      transcriberPromise = pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en");
    }
    return transcriberPromise;
  }

  // Cloud image/video generation (Gemini) — the one feature in this app that
  // genuinely needs internet + an API key. Chat/memory/voice stay local.
  let genAI: GoogleGenAI | null = null;
  function getGenAI(): GoogleGenAI {
    if (!genAI) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY not set — add it to .env.local to use image/video generation.");
      }
      genAI = new GoogleGenAI({ apiKey });
    }
    return genAI;
  }

  function cosineSimilarity(v1: number[], v2: number[]) {
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    for (let i = 0; i < v1.length; i++) {
      dotProduct += v1[i] * v2[i];
      norm1 += v1[i] * v1[i];
      norm2 += v2[i] * v2[i];
    }
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  async function getRelevantMemories(query: string, topK = 3) {
    const e = await ensureEmbedder();
    const output = await e(query, { pooling: "mean", normalize: true });
    const queryVector = Array.from(output.data) as number[];

    const scored = memoryStore.map(m => ({
      ...m,
      score: cosineSimilarity(queryVector, m.vector)
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter(m => m.score > 0.5); // Minimum threshold
  }

  // Config persistence (currently just modelsDir) — a real, user-editable
  // override for where GGUF files live, instead of a hardcoded "models/".
  const CONFIG_FILE = path.join(process.cwd(), "config.json");
  interface ServerConfig { modelsDir?: string; comfyuiPath?: string; customDirs?: string[]; disabledSources?: string[] }
  let serverConfig: ServerConfig = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      serverConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    } catch (e) {
      console.error("[Config] Failed to load config.json", e);
    }
  }
  function saveConfig() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(serverConfig, null, 2));
  }

  let MODELS_DIR = serverConfig.modelsDir && fs.existsSync(serverConfig.modelsDir)
    ? serverConfig.modelsDir
    : path.join(process.cwd(), "models");
  fs.mkdirSync(MODELS_DIR, { recursive: true });

  // Models are read where they already live (download folder, LM Studio, Ollama, user-added folders) - never copied.
  const localModels = createLocalModels({
    getDownloadDir: () => MODELS_DIR,
    getConfig: () => ({ customDirs: serverConfig.customDirs, disabledSources: serverConfig.disabledSources }),
  });

  async function ensureLlama() {
    if (!llama) {
      console.log("[Llama] Initializing Llama instance...");
      llama = await getLlama();
    }
    return llama;
  }

  // .gguf files under the models folder, as posix-style relative paths. Goes a few
  // levels deep so LM Studio's "publisher/repo/file.gguf" layout is found too.
  function listGguf(dir = MODELS_DIR, rel = "", depth = 0): string[] {
    if (depth > 4) return [];
    let out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) out = out.concat(listGguf(path.join(dir, e.name), r, depth + 1));
      else if (e.name.toLowerCase().endsWith(".gguf")) out.push(r);
    }
    return out;
  }

  // Keeps a model id inside the models folder (no ../ escapes).
  function inModelsDir(rel: string): string | null {
    const p = path.resolve(MODELS_DIR, rel);
    return p.startsWith(path.resolve(MODELS_DIR) + path.sep) ? p : null;
  }

  function resolveModelPath(modelName: string): string {
    const known = localModels.scan().models.find(m => m.id === modelName);
    if (known) return known.file;
    const candidates = [
      inModelsDir(`${modelName}.gguf`),
      inModelsDir(modelName),
    ].filter((p): p is string => !!p);
    const found = candidates.find(p => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!found) {
      throw new Error(`Model ${modelName} not found in ${MODELS_DIR}. Download it from the Models tab first.`);
    }
    return found;
  }

  async function loadModel(modelName: string) {
    const l = await ensureLlama();
    const modelPath = resolveModelPath(modelName);

    if (activeModelName === modelName && modelInstance) {
      return modelInstance;
    }

    const profile = PERFORMANCE_PROFILES[performanceMode];
    console.log(`[Llama] Loading model: ${modelPath} (threads=${userThreads ?? profile.threads}, batchSize=${profile.batchSize})`);
    modelInstance = await l.loadModel({ modelPath });
    context = await modelInstance.createContext({
      threads: userThreads ?? profile.threads,
      batchSize: profile.batchSize,
      contextSize: userContextSize ?? "auto",
    });
    session = new LlamaChatSession({
      contextSequence: context.getSequence()
    });
    activeModelName = modelName;
    return modelInstance;
  }

  // Reload the current context in place so a mode/thread change takes effect
  // immediately instead of waiting for the next model switch.
  async function applyEngineConfigNow() {
    if (!activeModelName || !modelInstance) return;
    const profile = PERFORMANCE_PROFILES[performanceMode];
    context = await modelInstance.createContext({
      threads: userThreads ?? profile.threads,
      batchSize: profile.batchSize,
      contextSize: userContextSize ?? "auto",
    });
    session = new LlamaChatSession({
      contextSequence: context.getSequence()
    });
  }

  // --- External local servers: Ollama and LM Studio ------------------------
  // Their models are discovered live from their own local APIs and chatted
  // with by proxying - ids are "ollama:<name>" / "lmstudio:<id>".
  const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  const LMSTUDIO_URL = process.env.LMSTUDIO_URL || "http://127.0.0.1:1234";
  registerHub(app, { getModelsDir: () => MODELS_DIR, ollamaUrl: OLLAMA_URL, findExisting: (fileName) => localModels.findByFileName(fileName)?.file,
    getComfyModelsDir: () => {
      const base = process.env.COMFYUI_PATH || serverConfig.comfyuiPath;
      if (!base) return null;
      return [path.join(base, "ComfyUI", "models"), path.join(base, "models")].find(p => fs.existsSync(p)) || null;
    },
  });

  const ollamaCaps = new Map<string, string[]>();
  async function listExternalModels() {
    const out: { ollama: any; lmstudio: any } = {
      ollama: { running: false, models: [] as string[] },
      lmstudio: { running: false, models: [] as string[] },
    };
    try {
      const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) {
        const d: any = await r.json();
        const names: string[] = (d.models || []).filter((m: any) => !/embed/i.test(m.name)).map((m: any) => m.name);
        // Ollama reports each model's real capabilities (vision, tools, thinking...); cached per name.
        const caps: Record<string, string[]> = {};
        await Promise.all(names.map(async (n) => {
          if (!ollamaCaps.has(n)) {
            try {
              const sr = await fetch(`${OLLAMA_URL}/api/show`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: n }), signal: AbortSignal.timeout(3000) });
              if (sr.ok) ollamaCaps.set(n, ((await sr.json()) as any).capabilities || []);
            } catch { /* leave unknown; name-based flags still apply */ }
          }
          if (ollamaCaps.has(n)) caps[n] = ollamaCaps.get(n)!;
        }));
        const sizes: Record<string, number> = {};
        for (const m of d.models || []) if (!/cloud/i.test(m.name)) sizes[m.name] = m.size || 0; // cloud models run elsewhere
        out.ollama = { running: true, models: names, caps, sizes };
      }
    } catch {}
    try {
      const r = await fetch(`${LMSTUDIO_URL}/v1/models`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) {
        const d: any = await r.json();
        out.lmstudio = { running: true, models: (d.data || []).map((m: any) => m.id).filter((id: string) => !/embed/i.test(id)) };
      }
    } catch {}
    return out;
  }

  app.get("/api/health", (req, res) => res.json({ ok: true }));

  // Load the offline speech model and run one tiny dummy pass now, so the first spoken sentence is not slow.
  ensureTranscriber().then(t => t(new Float32Array(16000), { max_new_tokens: 4 })).then(() => console.log("[Voice] Offline speech model warmed up.")).catch(() => { /* first real use will report the problem */ });

  // What the built-in engine actually runs on (GPU backend picked by llama.cpp, or CPU).
  app.get("/api/engine/gpu", async (req, res) => {
    try {
      const l: any = await ensureLlama();
      res.json({ backend: l.gpu || "cpu", devices: await l.getGpuDeviceNames().catch(() => []) });
    } catch (e: any) {
      res.json({ backend: "unknown", devices: [] });
    }
  });
  registerSystemStats(app);

  app.get("/api/external-models", async (req, res) => {
    res.json(await listExternalModels());
  });

  // Streams a chat through Ollama or LM Studio, emitting the same SSE
  // {token} / [DONE] / {error} frames the local engine does.
  async function proxyExternalChat(provider: "ollama" | "lmstudio", model: string, messages: any[], options: any, res: express.Response, signal: AbortSignal) {
    // Images ride along as base64 (Ollama) or image_url parts (LM Studio); only vision models use them.
    const history = (messages || []).map((m: any) => {
      const imgs: string[] = Array.isArray(m.images) ? m.images : [];
      if (!imgs.length) return { role: m.role, content: m.content };
      if (provider === "ollama") return { role: m.role, content: m.content, images: imgs.map(i => i.replace(/^data:[^,]*,/, "")) };
      return { role: m.role, content: [{ type: "text", text: m.content }, ...imgs.map(url => ({ type: "image_url", image_url: { url } }))] };
    });
    const send = (o: any) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const label = provider === "ollama" ? "Ollama" : "LM Studio";
    let resp: Response;
    try {
      resp = provider === "ollama"
        ? await fetch(`${OLLAMA_URL}/api/chat`, {
            method: "POST", signal, headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, messages: history, stream: true, options: { temperature: options?.temperature, top_p: options?.topP, num_predict: options?.maxTokens, num_ctx: 4096 } }),
          })
        : await fetch(`${LMSTUDIO_URL}/v1/chat/completions`, {
            method: "POST", signal, headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, messages: history, stream: true, temperature: options?.temperature, top_p: options?.topP, max_tokens: options?.maxTokens }),
          });
    } catch (e: any) {
      if (signal.aborted) return;
      throw new Error(`Could not reach ${label} - is it running? (${e.message})`);
    }
    if (!resp.ok || !resp.body) {
      throw new Error(`${label} returned HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        let line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        if (provider === "lmstudio") {
          if (!line.startsWith("data:")) continue;
          line = line.slice(5).trim();
          if (line === "[DONE]") continue;
        }
        let j: any;
        try { j = JSON.parse(line); } catch { continue; }
        if (j.error) throw new Error(typeof j.error === "string" ? j.error : JSON.stringify(j.error));
        const token = provider === "ollama" ? j.message?.content : j.choices?.[0]?.delta?.content;
        if (token) send({ token });
      }
    }
  }

  // API Route: pull plain text out of an attached document (PDF, DOCX, anything text-like).
  app.post("/api/attachments/extract", express.raw({ type: "*/*", limit: "50mb" }), async (req, res) => {
    const name = String(req.query.name || "file");
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: "Empty file" });
    try {
      let text = "";
      if (/.pdf$/i.test(name)) {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(buf));
        text = (await extractText(pdf, { mergePages: true })).text as string;
      } else if (/.docx$/i.test(name)) {
        const mammoth = (await import("mammoth")).default;
        text = (await mammoth.extractRawText({ buffer: buf })).value;
      } else {
        text = buf.toString("utf8");
        if (text.includes(" ")) return res.status(415).json({ error: `"${name}" looks like a binary file - attach text, code, PDF, DOCX or images.` });
      }
      text = text.trim();
      if (!text) return res.status(422).json({ error: `No readable text found in "${name}" (scanned PDFs need OCR).` });
      res.json({ text });
    } catch (e: any) {
      res.status(500).json({ error: `Couldn't read "${name}": ${e.message}` });
    }
  });

  // API Route: Real Local LLM Inference with Streaming
  app.post("/api/chat", async (req, res) => {
    const { messages, prompt, model: modelName, options } = req.body;

    if (isInferenceRunning) {
      return res.status(429).json({ error: "Inference already in progress. Please wait." });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const abortController = new AbortController();
    // Listen on the RESPONSE: on current Node, req 'close' fires as soon as
    // the request body has been read, which aborted every chat instantly.
    res.on('close', () => {
      if (res.writableFinished) return;
      console.log("[LocalRuntime] Client disconnected. Aborting inference...");
      abortController.abort();
    });

    try {
      isInferenceRunning = true;
      const ext = /^(ollama|lmstudio):(.+)$/.exec(modelName || "");
      if (ext) {
        console.log(`[External] Chat via ${ext[1]}: ${ext[2]}`);
        await proxyExternalChat(ext[1] as "ollama" | "lmstudio", ext[2], messages, options, res, abortController.signal);
        res.write(`data: [DONE]\n\n`);
        res.end();
        return;
      }
      await loadModel(modelName || "phi-3-mini");

      let finalPrompt = "";
      let userQuery = "";

      if (messages && messages.length > 0) {
        userQuery = messages[messages.length - 1].content;
        // node-llama-cpp wants its own message shape ({type, text} / {type: "model", response}), not {role, content}.
        const history = messages.slice(0, -1).map((m: any) =>
          m.role === "system" ? { type: "system", text: m.content }
          : m.role === "user" ? { type: "user", text: m.content }
          : { type: "model", response: [m.content] });
        finalPrompt = userQuery;
        await session.setChatHistory(history as any);
      } else {
        userQuery = prompt;
        finalPrompt = prompt;
      }

      // RAG: Inject relevant memories (unless the user turned this off in Settings)
      const memories = options?.memoryEnabled === false ? [] : await getRelevantMemories(userQuery);
      if (memories.length > 0) {
        const contextInjection = memories.map(m => `Relevant memory: ${m.text}`).join("\n");
        finalPrompt = `Context from user memory:\n${contextInjection}\n\nUser Question: ${finalPrompt}`;
        console.log(`[LocalRuntime] Injected ${memories.length} memories into context.`);
      }

      console.log(`[LocalRuntime] Inference start: ${activeModelName} -> "${finalPrompt.slice(0, 50)}..."`);
      console.log(`[LocalRuntime] Options:`, options);

      const generationStart = Date.now();
      let tokenCount = 0;

      await session.prompt(finalPrompt, {
        temperature: options?.temperature ?? 0.7,
        topP: options?.topP ?? 0.9,
        maxTokens: options?.maxTokens ?? 1024,
        signal: abortController.signal,
        // Streams decoded text (llama.decode doesn't exist; onToken only gives raw token ids).
        onTextChunk(token: string) {
          tokenCount++;
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
      });

      const elapsedSec = (Date.now() - generationStart) / 1000;
      lastGenerationTps = elapsedSec > 0 ? tokenCount / elapsedSec : 0;
      totalTokensGenerated += tokenCount;

      res.write(`data: [DONE]\n\n`);
      res.end();
    } catch (error: any) {
      if (error.name === 'AbortError' || abortController.signal.aborted) {
         console.log("[LocalRuntime] Inference aborted successfully.");
      } else {
        console.error("[Llama Error]", error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      }
      res.write(`data: [DONE]\n\n`);
      res.end();
    } finally {
      isInferenceRunning = false;
    }
  });

  // API Route: Add to Memory
  app.post("/api/memory", async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required" });

    try {
      const e = await ensureEmbedder();
      const output = await e(text, { pooling: "mean", normalize: true });
      const vector = Array.from(output.data) as number[];

      memoryStore.push({
        text,
        vector,
        timestamp: Date.now()
      });
      saveMemory();

      console.log(`[Memory] Added new entry: ${text.slice(0, 30)}...`);
      res.json({ success: true, count: memoryStore.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API Route: List Memories
  app.get("/api/memory", (req, res) => {
    res.json(memoryStore.map(({ text, timestamp }) => ({ text, timestamp })));
  });

  // API Route: Wipe the entire memory store
  app.delete("/api/memory", (req, res) => {
    memoryStore = [];
    saveMemory();
    res.json({ status: "success" });
  });

  // API Route: Unload the active model to free RAM
  app.post("/api/engine/unload", (req, res) => {
    modelInstance = null;
    context = null;
    session = null;
    activeModelName = null;
    res.json({ status: "success" });
  });

  // API Route: Performance mode — actually changes llama.cpp thread/batch
  // config, applied immediately if a model is already loaded.
  app.post("/api/mode", async (req, res) => {
    const { mode } = req.body;
    if (!Object.keys(PERFORMANCE_PROFILES).includes(mode)) {
      return res.status(400).json({ error: `Invalid mode. Expected one of ${Object.keys(PERFORMANCE_PROFILES).join(", ")}` });
    }
    performanceMode = mode as PerformanceMode;
    try {
      await applyEngineConfigNow();
      res.json({ status: "success", mode: performanceMode });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API Route: Advanced engine config (threads / context size) from the Settings tab.
  app.post("/api/engine-config", async (req, res) => {
    const { threads, kvCacheSize } = req.body;
    if (typeof threads === "number") userThreads = threads;
    if (typeof kvCacheSize === "number") userContextSize = kvCacheSize;
    try {
      await applyEngineConfigNow();
      res.json({ status: "success", threads: userThreads, contextSize: userContextSize });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API Route: Memory and Resource Stats — all real, nothing fabricated.
  // This PC's memory, for the "will this model fit?" hints in the Models tab.
  app.get("/api/system", (req, res) => res.json({ totalBytes: os.totalmem(), freeBytes: os.freemem() }));

  app.get("/api/stats", (req, res) => {
    const memory = process.memoryUsage();
    res.json({
      ram: {
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024) + "MB",
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024) + "MB",
        heapUsedPct: Math.round((memory.heapUsed / memory.heapTotal) * 100),
        rss: Math.round(memory.rss / 1024 / 1024) + "MB",
      },
      model: {
        active: activeModelName,
        status: isInferenceRunning ? "busy" : "idle"
      },
      engine: {
        tps: lastGenerationTps,
        totalTokens: totalTokensGenerated,
        threads: userThreads ?? PERFORMANCE_PROFILES[performanceMode].threads,
        batch: PERFORMANCE_PROFILES[performanceMode].batchSize,
      },
      performanceMode,
      localAddress: `http://${getLocalNetworkAddress()}:${PORT}/api/*`,
    });
  });

  // API Route: Model Management
  app.get("/api/models", (req, res) => {
    const found = localModels.scan().models;
    res.json({
      storage: MODELS_DIR,
      active: activeModelName,
      available: found.map(m => m.id),
      sizes: Object.fromEntries(found.map(m => [m.id, m.size])),
      details: Object.fromEntries(found.map(m => [m.id, { name: m.name, origin: m.origin, label: m.label, file: m.file }])),
    });
  });

  // API Route: Real model download with genuine byte-progress over SSE.
  app.post("/api/models/download", async (req, res) => {
    const { id, url } = req.body;
    if (!id || !url) return res.status(400).json({ error: "id and url are required" });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const destPath = path.join(MODELS_DIR, `${id}.gguf`);
    const tmpPath = `${destPath}.part`;
    // Cancel button = the browser closes the stream; stop downloading and clean up.
    const ctl = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ctl.abort(); });

    try {
      const response = await fetch(url, { signal: ctl.signal });
      if (!response.ok || !response.body) {
        throw new Error(`Download failed: HTTP ${response.status}`);
      }
      const totalBytes = Number(response.headers.get("content-length") || 0);
      let receivedBytes = 0;

      const fileStream = fs.createWriteStream(tmpPath);
      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedBytes += value.byteLength;
        fileStream.write(Buffer.from(value));
        const pct = totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : undefined;
        res.write(`data: ${JSON.stringify({ receivedBytes, totalBytes, progress: pct })}\n\n`);
      }
      fileStream.end();
      await new Promise<void>(resolve => fileStream.on("finish", () => resolve()));

      fs.renameSync(tmpPath, destPath);
      res.write(`data: ${JSON.stringify({ progress: 100, done: true })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("[ModelDownload] Failed:", error);
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  // API Route: Delete a downloaded model — actually removes the file this time.
  app.delete("/api/models/:id", (req, res) => {
    if (req.params.id.startsWith("@")) return res.status(403).json({ error: "This model lives in another app's folder (LM Studio / Ollama / your own). Remove it from that app - Cursed_Ai only reads it." });
    const modelPath = inModelsDir(`${req.params.id}.gguf`);
    if (!modelPath) return res.status(400).json({ error: "Bad model id" });
    try {
      if (fs.existsSync(modelPath)) fs.unlinkSync(modelPath);
      if (activeModelName === req.params.id) {
        activeModelName = null;
        modelInstance = null;
        context = null;
        session = null;
      }
      res.json({ status: "success" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API Route: Server config (currently just the models directory override)
  app.get("/api/config", (req, res) => {
    res.json({ modelsDir: MODELS_DIR, isDefault: !serverConfig.modelsDir, ...modelDirs(), sources: localModels.scan().sources });
  });

  // Add / remove / switch off a folder Cursed_Ai reads models from (read-only; files are never moved or copied).
  app.post("/api/config/sources", (req, res) => {
    const { action, path: dir, id, enabled } = req.body || {};
    serverConfig.customDirs ??= [];
    serverConfig.disabledSources ??= [];
    if (action === "add") {
      if (typeof dir !== "string" || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return res.status(400).json({ error: "That folder doesn't exist." });
      if (!serverConfig.customDirs.some(d => path.resolve(d).toLowerCase() === path.resolve(dir).toLowerCase())) serverConfig.customDirs.push(dir);
    } else if (action === "remove") {
      serverConfig.customDirs = serverConfig.customDirs.filter(d => `c-${shortHash(d)}` !== id);
      serverConfig.disabledSources = serverConfig.disabledSources.filter(x => x !== id);
    } else if (action === "toggle") {
      const off = new Set(serverConfig.disabledSources);
      if (enabled) off.delete(id); else off.add(id);
      serverConfig.disabledSources = [...off];
    } else {
      return res.status(400).json({ error: "Unknown action" });
    }
    saveConfig();
    res.json({ sources: localModels.scan().sources });
  });

  app.post("/api/config", (req, res) => {
    const { modelsDir } = req.body;
    if (typeof modelsDir !== "string" || !modelsDir.trim()) {
      return res.status(400).json({ error: "modelsDir is required" });
    }
    try {
      if (!fs.existsSync(modelsDir)) {
        fs.mkdirSync(modelsDir, { recursive: true });
      }
      const stat = fs.statSync(modelsDir);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: "Path exists but is not a directory" });
      }
      MODELS_DIR = modelsDir;
      serverConfig.modelsDir = modelsDir;
      saveConfig();
      console.log(`[Config] Models directory set to: ${MODELS_DIR}`);
      res.json({ modelsDir: MODELS_DIR, isDefault: false });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API Route: Real filesystem browsing, backs the folder-picker in Settings
  // (a plain web page has no native folder-picker dialog that can hand back
  // a real OS path, so this is the actual way to let someone click through
  // their own disk instead of typing a path by hand).
  app.get("/api/browse-directory", (req, res) => {
    const requested = typeof req.query.path === "string" ? req.query.path : "";

    try {
      // No path yet: list drive roots on Windows, "/" on POSIX.
      if (!requested) {
        if (process.platform === "win32") {
          const drives: string[] = [];
          for (let code = 65; code <= 90; code++) {
            const drive = `${String.fromCharCode(code)}:\\`;
            if (fs.existsSync(drive)) drives.push(drive);
          }
          return res.json({ path: "", parent: null, entries: drives.map(d => ({ name: d, path: d, isDirectory: true })) });
        }
        return res.json({
          path: "/",
          parent: null,
          entries: fs.readdirSync("/", { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => ({ name: e.name, path: path.join("/", e.name), isDirectory: true })),
        });
      }

      const stat = fs.statSync(requested);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: "Not a directory" });
      }

      const entries = fs.readdirSync(requested, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith("."))
        .map(e => ({ name: e.name, path: path.join(requested, e.name), isDirectory: true }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const parent = path.dirname(requested);
      // On Windows, dirname("C:\\") is "C:\\" (root has no parent) - treat
      // that as "back to the drive list" (empty path) instead of a loop.
      const atRoot = parent === requested;

      res.json({ path: requested, parent: atRoot ? "" : parent, entries });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // API Route: Console — real log history + live SSE stream, backs the Console tab.
  app.get("/api/console/history", (req, res) => {
    res.json(logBuffer);
  });

  app.get("/api/console/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    logSubscribers.add(res);
    req.on("close", () => logSubscribers.delete(res));
  });

  // API Route: Local offline voice transcription (Whisper via transformers.js).
  // transformers.js's ASR pipeline needs raw Float32 PCM samples at 16kHz
  // mono when running in Node (it has no AudioContext to decode compressed
  // audio itself, unlike in a browser) - the client decodes/resamples the
  // recording before sending, and posts the raw Float32Array bytes here.
  app.post("/api/voice/transcribe", express.raw({ type: "application/octet-stream", limit: "25mb" }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "No audio data received" });
    }
    if (req.body.length % 4 !== 0) {
      return res.status(400).json({ error: "Audio payload must be raw 32-bit float PCM (length not a multiple of 4)" });
    }
    try {
      const t = await ensureTranscriber();
      const samples = new Float32Array(req.body.buffer, req.body.byteOffset, req.body.length / 4);
      const t0 = Date.now();
      const result = await t(samples, { max_new_tokens: 96, return_timestamps: false });
      console.log(`[Voice] whisper inference ${Date.now() - t0} ms`);
      const text = Array.isArray(result) ? result.map((r: any) => r.text).join(" ") : result.text;
      console.log(`[Voice] Transcribed ${samples.length} samples (~${(samples.length / 16000).toFixed(1)}s) -> "${(text || "").slice(0, 60)}..."`);
      res.json({ text: text || "" });
    } catch (error: any) {
      console.error("[Voice] Transcription failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- Gallery: generated images/videos are saved to disk (outputs/), so the
  // Image/Video tabs can show history, delete, and reveal in the file manager.
  const OUTPUTS_DIR = path.join(process.cwd(), "outputs");
  const galleryDir = (kind: string) => path.join(OUTPUTS_DIR, kind === "video" ? "videos" : "images");
  fs.mkdirSync(galleryDir("image"), { recursive: true });
  fs.mkdirSync(galleryDir("video"), { recursive: true });

  function saveToGallery(kind: "image" | "video", buffer: Buffer, ext: string): string {
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}${ext}`;
    fs.writeFileSync(path.join(galleryDir(kind), name), buffer);
    return name;
  }

  // Only plain file names inside the gallery folder - blocks path traversal.
  function galleryPath(kind: string, file: string): string | null {
    if (!file || file !== path.basename(file)) return null;
    const p = path.join(galleryDir(kind), file);
    return fs.existsSync(p) ? p : null;
  }

  app.get("/api/gallery", (req, res) => {
    const kind = req.query.kind === "video" ? "video" : "image";
    const dir = galleryDir(kind);
    const items = fs.readdirSync(dir)
      .filter(f => /\.(png|jpg|jpeg|webp|mp4)$/i.test(f))
      .map(f => ({ file: f, url: `/api/gallery/file/${kind}/${encodeURIComponent(f)}`, createdAt: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ dir, items });
  });

  app.get("/api/gallery/file/:kind/:file", (req, res) => {
    const p = galleryPath(req.params.kind, req.params.file);
    if (!p) return res.status(404).end();
    res.sendFile(p);
  });

  app.delete("/api/gallery/:kind/:file", (req, res) => {
    const p = galleryPath(req.params.kind, req.params.file);
    if (!p) return res.status(404).json({ error: "File not found" });
    fs.unlinkSync(p);
    res.json({ status: "success" });
  });

  // Opens the OS file manager with the file selected (Windows/macOS/Linux).
  app.post("/api/gallery/reveal", (req, res) => {
    const { kind, file } = req.body;
    const p = galleryPath(kind, file);
    if (!p) return res.status(404).json({ error: "File not found" });
    try {
      if (process.platform === "win32") spawn("explorer.exe", [`/select,${p}`], { detached: true, stdio: "ignore" }).unref();
      else if (process.platform === "darwin") spawn("open", ["-R", p], { detached: true, stdio: "ignore" }).unref();
      else spawn("xdg-open", [path.dirname(p)], { detached: true, stdio: "ignore" }).unref();
      res.json({ status: "success" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // API Route: Image generation (Gemini/Imagen — real, needs GEMINI_API_KEY + internet)
  app.post("/api/image/generate", async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt is required" });
    try {
      console.log(`[Image] Generating: "${prompt.slice(0, 60)}..."`);
      const ai = getGenAI();
      const response = await ai.models.generateImages({
        model: "imagen-4.0-generate-001",
        prompt,
        config: { numberOfImages: 1 },
      });
      const img = response.generatedImages?.[0]?.image;
      if (!img?.imageBytes) throw new Error("No image returned by the API");
      const mime = img.mimeType || "image/png";
      const file = saveToGallery("image", Buffer.from(img.imageBytes, "base64"), mime.includes("jpeg") ? ".jpg" : ".png");
      res.json({ src: `data:${mime};base64,${img.imageBytes}`, file });
    } catch (error: any) {
      console.error("[Image] Generation failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route: Video generation (Gemini/Veo — real, async job since it takes minutes)
  interface VideoJobInternal {
    id: string;
    prompt: string;
    status: "pending" | "done" | "error" | "cancelled";
    abort?: AbortController;
    videoPath?: string;
    galleryFile?: string;
    error?: string;
    createdAt: number;
  }
  const videoJobs = new Map<string, VideoJobInternal>();
  const VIDEO_TMP_DIR = path.join(os.tmpdir(), "cursed-videos");
  fs.mkdirSync(VIDEO_TMP_DIR, { recursive: true });

  app.post("/api/video/generate", (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt is required" });

    const id = Date.now().toString();
    const job: VideoJobInternal = { id, prompt, status: "pending", createdAt: Date.now(), abort: new AbortController() };
    videoJobs.set(id, job);
    res.json({ id, status: "pending" });

    (async () => {
      try {
        console.log(`[Video] Generating: "${prompt.slice(0, 60)}..." (job ${id})`);
        const ai = getGenAI();
        let operation = await ai.models.generateVideos({
          model: "veo-2.0-generate-001",
          prompt,
          config: { numberOfVideos: 1 },
        });
        while (!operation.done) {
          if (job.abort!.signal.aborted) throw new Error("Cancelled");
          await new Promise(resolve => setTimeout(resolve, 3000));
          operation = await ai.operations.getVideosOperation({ operation });
        }
        const generated = operation.response?.generatedVideos?.[0];
        if (!generated?.video) throw new Error("No video returned by the API");

        const videoPath = path.join(VIDEO_TMP_DIR, `${id}.mp4`);
        if (generated.video.videoBytes) {
          fs.writeFileSync(videoPath, Buffer.from(generated.video.videoBytes, "base64"));
        } else {
          await ai.files.download({ file: generated.video, downloadPath: videoPath });
        }
        job.videoPath = videoPath;
        job.galleryFile = saveToGallery("video", fs.readFileSync(videoPath), ".mp4");
        job.status = "done";
        console.log(`[Video] Job ${id} done -> ${videoPath}`);
      } catch (error: any) {
        if (job.abort?.signal.aborted) { job.status = "cancelled"; return; }
        console.error(`[Video] Job ${id} failed:`, error);
        job.status = "error";
        job.error = error.message;
      }
    })();
  });

  app.post("/api/video/cancel/:id", (req, res) => {
    const job = videoJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status === "pending") { job.abort?.abort(); job.status = "cancelled"; }
    res.json({ id: job.id, status: job.status });
  });

  app.get("/api/video/status/:id", (req, res) => {
    const job = videoJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json({
      id: job.id,
      status: job.status,
      error: job.error,
      resultUrl: job.status === "done" ? `/api/video/result/${job.id}` : undefined,
      file: job.galleryFile,
    });
  });

  app.get("/api/video/result/:id", (req, res) => {
    const job = videoJobs.get(req.params.id);
    if (!job || job.status !== "done" || !job.videoPath || !fs.existsSync(job.videoPath)) {
      return res.status(404).end();
    }
    res.setHeader("Content-Type", "video/mp4");
    fs.createReadStream(job.videoPath).pipe(res);
  });

  // --- ComfyUI: offline/local image & video generation ---------------------
  // Talks to a locally-running ComfyUI instance (default install, default
  // port) over its REST API. Two hardcoded image workflows (plain txt2img,
  // and img2img using a reference image) built entirely from ComfyUI's core
  // nodes - no custom node packs required. Video uses Stable Video Diffusion
  // (also core) + VHS_VideoCombine for real .mp4 export, which DOES require
  // the ComfyUI-VideoHelperSuite custom node pack installed.
  //
  // Not testable in this environment (no local ComfyUI/GPU/checkpoints
  // available here) - built carefully against ComfyUI's documented, stable
  // API and node contracts, but the very first real run against your
  // instance is the actual verification. If a node's input names have
  // drifted from what's below (ComfyUI node schemas do change over time),
  // the error message ComfyUI returns will name the exact node/field.
  const COMFYUI_URL = process.env.COMFYUI_URL || "http://127.0.0.1:8188";

  async function comfyFetch(pathSuffix: string, options?: RequestInit): Promise<Response> {
    let resp: Response;
    try {
      resp = await fetch(`${COMFYUI_URL}${pathSuffix}`, options);
    } catch (e: any) {
      throw new Error(`Could not reach ComfyUI at ${COMFYUI_URL} - is it running? (${e.message})`);
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`ComfyUI request to ${pathSuffix} failed: HTTP ${resp.status} ${body.slice(0, 200)}`);
    }
    return resp;
  }

  // Uploads a base64 data URL to ComfyUI's own input folder; ComfyUI's
  // LoadImage node can only reference files it already has, not arbitrary
  // bytes we send inline in the workflow.
  async function uploadImageToComfyUI(dataUrl: string, filename: string): Promise<string> {
    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!match) throw new Error("Invalid image data URL");
    const [, mimeType, base64] = match;
    const buffer = Buffer.from(base64, "base64");

    const form = new FormData();
    form.append("image", new Blob([buffer], { type: mimeType }), filename);
    form.append("overwrite", "true");

    const resp = await comfyFetch("/upload/image", { method: "POST", body: form });
    const data = await resp.json();
    return data.name;
  }

  // Queues a workflow graph, polls /history until ComfyUI finishes it, and
  // returns the named output node's data (e.g. the SaveImage/VHS_VideoCombine
  // node's result). ComfyUI has no simple "wait for it" endpoint - polling
  // is the standard integration pattern (same as everyone's ComfyUI API
  // client scripts do).
  // Stop a ComfyUI job: drop it from the queue, and interrupt it if it's the one running.
  async function cancelComfyPrompt(promptId: string) {
    try {
      await fetch(`${COMFYUI_URL}/queue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [promptId] }) });
      const q: any = await (await fetch(`${COMFYUI_URL}/queue`)).json();
      if ((q.queue_running || []).some((e: any) => e[1] === promptId)) {
        await fetch(`${COMFYUI_URL}/interrupt`, { method: "POST" });
      }
    } catch { /* ComfyUI gone - nothing left to cancel */ }
  }

  // Live progress of running jobs, polled by the UI: token -> { percent (null = unknown), label }.
  const progressMap = new Map<string, { percent: number | null; label: string; at: number }>();
  const setProgress = (token: string | undefined, percent: number | null, label: string) => { if (token) progressMap.set(token, { percent, label, at: Date.now() }); };
  app.get("/api/progress/:token", (req, res) => res.json(progressMap.get(req.params.token) || { percent: null, label: "Starting..." }));
  setInterval(() => { for (const [k, v] of progressMap) if (Date.now() - v.at > 600000) progressMap.delete(k); }, 60000).unref();

  // ComfyUI reports sampler steps over its websocket; relay them so the UI can show a real bar.
  async function runComfyWorkflow(workflow: Record<string, any>, outputNodeId: string, signal?: AbortSignal, progressToken?: string): Promise<any> {
    const clientId = crypto.randomUUID();
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`${COMFYUI_URL.replace(/^http/, "ws")}/ws?clientId=${clientId}`);
      ws.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data !== "string") return;
        try {
          const m = JSON.parse(ev.data);
          if (m.type === "progress" && m.data?.max) setProgress(progressToken, Math.round((m.data.value / m.data.max) * 100), `Step ${m.data.value} of ${m.data.max}`);
          else if (m.type === "execution_start") setProgress(progressToken, 0, "Loading model...");
          else if (m.type === "executing" && m.data?.node) setProgress(progressToken, null, "Working...");
        } catch { /* not JSON */ }
      };
    } catch { /* progress is a nicety; the job still runs */ }
    setProgress(progressToken, null, "Queued...");
    try {
      return await runComfyWorkflowCore(workflow, outputNodeId, signal, progressToken, clientId);
    } finally {
      try { ws?.close(); } catch { /* already closed */ }
    }
  }

  async function runComfyWorkflowCore(workflow: Record<string, any>, outputNodeId: string, signal: AbortSignal | undefined, progressToken: string | undefined, clientId: string): Promise<any> {
    const queueResp = await comfyFetch("/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });
    const queued: any = await queueResp.json();
    if (queued.error) {
      throw new Error(queued.error.message || "ComfyUI rejected the workflow (invalid node graph)");
    }
    const promptId = queued.prompt_id;
    if (!promptId) throw new Error("ComfyUI did not return a prompt_id");

    const maxAttempts = 600; // 600 * 1s = up to 10 minutes
    for (let i = 0; i < maxAttempts; i++) {
      if (signal?.aborted) { await cancelComfyPrompt(promptId); throw new Error("Cancelled"); }
      await new Promise(resolve => setTimeout(resolve, 1000));
      const histResp = await comfyFetch(`/history/${promptId}`);
      const history: any = await histResp.json();
      const entry = history[promptId];
      if (!entry) continue;
      if (entry.status?.status_str === "error") {
        throw new Error("ComfyUI workflow failed - check the ComfyUI console/terminal for the exact node error");
      }
      if (entry.outputs?.[outputNodeId]) {
        setProgress(progressToken, 100, "Finishing...");
        return entry.outputs[outputNodeId];
      }
    }
    throw new Error("Timed out waiting for ComfyUI (10 min) - it may still be running; check its console");
  }

  async function fetchComfyFile(filename: string, subfolder: string, type: string): Promise<Buffer> {
    const params = new URLSearchParams({ filename, subfolder: subfolder || "", type: type || "output" });
    const resp = await comfyFetch(`/view?${params}`);
    return Buffer.from(await resp.arrayBuffer());
  }

  // --- Start/stop awareness for ComfyUI: the UI's "Start ComfyUI" button hits
  // these. Status is a real ping of ComfyUI's /system_stats; start launches the
  // configured executable (ComfyUI Desktop's default install path, an env var
  // COMFYUI_PATH, or config.json "comfyuiPath") detached, then waits for it
  // to answer.
  async function isComfyRunning(): Promise<boolean> {
    try {
      const r = await fetch(`${COMFYUI_URL}/system_stats`, { signal: AbortSignal.timeout(2000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  // Resolve how to launch ComfyUI from the user's chosen install folder:
  // a portable build's run_*.bat, else python main.py (embedded python first).
  // A direct path to a .exe/.bat is accepted too. Deliberately NOT guessing at
  // ComfyUI Desktop's exe: launching that for someone without a finished
  // setup starts its installer.
  function resolveComfyLaunch(): { cmd: string; args: string[]; cwd: string; shell: boolean } | null {
    const target = process.env.COMFYUI_PATH || serverConfig.comfyuiPath;
    if (!target || !fs.existsSync(target)) return null;
    if (fs.statSync(target).isFile()) {
      return { cmd: target, args: [], cwd: path.dirname(target), shell: /.(bat|cmd)$/i.test(target) };
    }
    for (const bat of ["run_nvidia_gpu.bat", "run_amd_gpu.bat", "run.bat", "run_cpu.bat"]) {
      const p = path.join(target, bat);
      if (fs.existsSync(p)) return { cmd: p, args: [], cwd: target, shell: true };
    }
    const main = [path.join(target, "main.py"), path.join(target, "ComfyUI", "main.py")].find(fs.existsSync);
    if (main) {
      const root = path.dirname(main);
      const py = [path.join(target, "python_embeded", "python.exe"), path.join(root, "venv", "Scripts", "python.exe"), path.join(root, ".venv", "Scripts", "python.exe")].find(fs.existsSync) || "python";
      return { cmd: py, args: [main], cwd: root, shell: false };
    }
    return null;
  }

  let comfyStarting: Promise<void> | null = null;

  app.get("/api/comfyui/status", async (req, res) => {
    res.json({
      running: await isComfyRunning(),
      starting: !!comfyStarting,
      folder: process.env.COMFYUI_PATH || serverConfig.comfyuiPath || null,
      canLaunch: !!resolveComfyLaunch(),
    });
  });

  app.post("/api/comfyui/config", (req, res) => {
    const { path: p } = req.body;
    if (typeof p !== "string" || !fs.existsSync(p)) return res.status(400).json({ error: "Path doesn't exist" });
    serverConfig.comfyuiPath = p;
    saveConfig();
    const ok = !!resolveComfyLaunch();
    console.log(`[Config] ComfyUI folder set to: ${p} (launchable=${ok})`);
    if (!ok) return res.status(400).json({ error: "No run_*.bat or main.py found in that folder" });
    res.json({ folder: p, canLaunch: true });
  });

  app.post("/api/comfyui/start", async (req, res) => {
    if (await isComfyRunning()) return res.json({ running: true, alreadyRunning: true });
    const launch = resolveComfyLaunch();
    if (!launch) {
      return res.status(404).json({
        error: "Set your ComfyUI folder first (button next to the status). It needs a run_*.bat or main.py in it.",
      });
    }
    try {
      if (!comfyStarting) {
        console.log(`[ComfyUI] Not running - launching ${launch.cmd} ${launch.args.join(" ")} (cwd ${launch.cwd})`);
        comfyStarting = (async () => {
          const child = spawn(launch.cmd, launch.args, { detached: true, stdio: "ignore", cwd: launch.cwd, shell: launch.shell, windowsHide: false });
          child.unref();
          for (let i = 0; i < 90; i++) { // up to ~3 minutes: first launch loads models/nodes
            await new Promise(r => setTimeout(r, 2000));
            if (await isComfyRunning()) return;
          }
          throw new Error("ComfyUI was launched but didn't answer within 3 minutes");
        })().finally(() => { comfyStarting = null; });
      }
      await comfyStarting;
      console.log("[ComfyUI] Now running");
      res.json({ running: true, alreadyRunning: false });
    } catch (error: any) {
      console.error("[ComfyUI] Start failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route: List installed checkpoints, straight from ComfyUI's own
  // node-info introspection - real, live, reflects whatever's actually in
  // your models/checkpoints folder right now.
  app.get("/api/comfyui/checkpoints", async (req, res) => {
    const kind = "CheckpointLoaderSimple"; // LTX-Video uses the same loader/folder as image checkpoints
    try {
      const resp = await comfyFetch(`/object_info/${kind}`);
      const data: any = await resp.json();
      const names: string[] = data[kind]?.input?.required?.ckpt_name?.[0] || [];
      res.json({ checkpoints: names });
    } catch (error: any) {
      res.status(503).json({ error: error.message });
    }
  });

  // API Route: Local image generation via ComfyUI - two hardcoded workflows.
  // Without a referenceImage: plain txt2img (CheckpointLoader -> CLIP encode
  // -> EmptyLatentImage -> KSampler -> VAEDecode -> SaveImage). With one:
  // img2img using the reference (LoadImage -> VAEEncode feeds KSampler's
  // latent input instead, with denoise < 1 to preserve the reference).
  app.post("/api/comfyui/image/generate", async (req, res) => {
    const { prompt, negativePrompt, checkpoint, width, height, referenceImage } = req.body;
    if (!prompt || !checkpoint) return res.status(400).json({ error: "prompt and checkpoint are required" });
    // Stop button = the browser aborts the request; then we cancel the ComfyUI job too.
    const ctl = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ctl.abort(); });

    try {
      console.log(`[ComfyUI Image] Generating: "${String(prompt).slice(0, 60)}..." (checkpoint=${checkpoint}, hasReference=${!!referenceImage})`);
      const seed = Math.floor(Math.random() * 1e15);

      const workflow: Record<string, any> = {
        "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
        "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["4", 1] } },
        "7": { class_type: "CLIPTextEncode", inputs: { text: negativePrompt || "", clip: ["4", 1] } },
      };

      let latentSource: [string, number];
      let denoise = 1;
      if (referenceImage) {
        const uploadedName = await uploadImageToComfyUI(referenceImage, `cursed-ref-${Date.now()}.png`);
        workflow["10"] = { class_type: "LoadImage", inputs: { image: uploadedName } };
        workflow["11"] = { class_type: "VAEEncode", inputs: { pixels: ["10", 0], vae: ["4", 2] } };
        latentSource = ["11", 0];
        denoise = 0.65; // partial denoise: follow the reference's structure, not just its pixels
      } else {
        workflow["5"] = { class_type: "EmptyLatentImage", inputs: { width: width || 512, height: height || 512, batch_size: 1 } };
        latentSource = ["5", 0];
      }

      workflow["3"] = {
        class_type: "KSampler",
        inputs: {
          seed, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise,
          model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: latentSource,
        },
      };
      workflow["8"] = { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } };
      workflow["9"] = { class_type: "SaveImage", inputs: { filename_prefix: "cursed", images: ["8", 0] } };

      const output = await runComfyWorkflow(workflow, "9", ctl.signal, req.body.token);
      const img = output?.images?.[0];
      if (!img) throw new Error("ComfyUI returned no image output");
      const buffer = await fetchComfyFile(img.filename, img.subfolder, img.type);
      const file = saveToGallery("image", buffer, ".png");
      res.json({ src: `data:image/png;base64,${buffer.toString("base64")}`, file });
    } catch (error: any) {
      if (ctl.signal.aborted) { console.log("[ComfyUI Image] Cancelled by user."); return; }
      console.error("[ComfyUI Image] Generation failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route: Local video generation via ComfyUI - LTX-Video (text-to-video,
  // optionally conditioned on a starting image). Node names/inputs below were
  // read from a live ComfyUI instance's /object_info (EmptyLTXVLatentVideo,
  // LTXVImgToVideo, LTXVConditioning, ModelSamplingLTXV, LTXVScheduler,
  // KSamplerSelect, SamplerCustom). Text encoder is a separate T5 loaded via
  // CLIPLoader type "ltxv", per ComfyUI's LTXV convention. Async job, same
  // status/result endpoints as the Gemini video path.
  app.post("/api/comfyui/video/generate", (req, res) => {
    const { prompt, negativePrompt, image, checkpoint, width, height, frames, fps } = req.body;
    if (!prompt || !checkpoint) return res.status(400).json({ error: "prompt and checkpoint are required" });

    const id = Date.now().toString();
    const job: VideoJobInternal = { id, prompt, status: "pending", createdAt: Date.now(), abort: new AbortController() };
    videoJobs.set(id, job);
    res.json({ id, status: "pending" });

    (async () => {
      try {
        console.log(`[ComfyUI Video] Generating LTX-Video clip (checkpoint=${checkpoint}, hasImage=${!!image}, job ${id})`);
        const seed = Math.floor(Math.random() * 1e15);
        const frameRate = fps || 25;
        const w = width || 768, h = height || 512;
        const length = frames || 97; // LTXV wants 8n+1 frames

        // Pick a T5 text encoder from whatever's installed.
        const clipInfo: any = await (await comfyFetch("/object_info/CLIPLoader")).json();
        const clipNames: string[] = clipInfo.CLIPLoader?.input?.required?.clip_name?.[0] || [];
        const clipName = clipNames.find(n => /t5xxl.*fp16/i.test(n)) || clipNames.find(n => /t5xxl/i.test(n));
        if (!clipName) throw new Error("No T5-XXL text encoder found in ComfyUI's clip folder (needed by LTX-Video)");

        const workflow: Record<string, any> = {
          "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
          "2": { class_type: "CLIPLoader", inputs: { clip_name: clipName, type: "ltxv" } },
          "3": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
          "4": { class_type: "CLIPTextEncode", inputs: { text: negativePrompt || "worst quality, inconsistent motion, blurry, jittery, distorted", clip: ["2", 0] } },
          "5": { class_type: "LTXVConditioning", inputs: { positive: ["3", 0], negative: ["4", 0], frame_rate: frameRate } },
        };

        let positiveRef: [string, number] = ["5", 0];
        let negativeRef: [string, number] = ["5", 1];
        let latentRef: [string, number];

        if (image) {
          const uploadedName = await uploadImageToComfyUI(image, `cursed-ltxv-${id}.png`);
          workflow["6"] = { class_type: "LoadImage", inputs: { image: uploadedName } };
          workflow["7"] = {
            class_type: "LTXVImgToVideo",
            inputs: {
              positive: positiveRef, negative: negativeRef, vae: ["1", 2], image: ["6", 0],
              width: w, height: h, length, batch_size: 1, strength: 1,
            },
          };
          positiveRef = ["7", 0];
          negativeRef = ["7", 1];
          latentRef = ["7", 2];
        } else {
          workflow["7"] = { class_type: "EmptyLTXVLatentVideo", inputs: { width: w, height: h, length, batch_size: 1 } };
          latentRef = ["7", 0];
        }

        workflow["8"] = { class_type: "ModelSamplingLTXV", inputs: { model: ["1", 0], max_shift: 2.05, base_shift: 0.95, latent: latentRef } };
        workflow["9"] = { class_type: "LTXVScheduler", inputs: { steps: 30, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1, latent: latentRef } };
        workflow["10"] = { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } };
        workflow["11"] = {
          class_type: "SamplerCustom",
          inputs: {
            model: ["8", 0], add_noise: true, noise_seed: seed, cfg: 3,
            positive: positiveRef, negative: negativeRef,
            sampler: ["10", 0], sigmas: ["9", 0], latent_image: latentRef,
          },
        };
        workflow["12"] = { class_type: "VAEDecode", inputs: { samples: ["11", 0], vae: ["1", 2] } };
        // Core nodes only (no VideoHelperSuite needed): CreateVideo -> SaveVideo mp4.
        workflow["13"] = { class_type: "CreateVideo", inputs: { images: ["12", 0], fps: frameRate } };
        workflow["14"] = { class_type: "SaveVideo", inputs: { video: ["13", 0], filename_prefix: "video/cursed", format: "mp4", codec: "h264" } };

        const output = await runComfyWorkflow(workflow, "14", job.abort!.signal, id);
        // SaveVideo reports its file under "images" (with animated:true); older
        // video savers used "gifs"/"videos" - accept any.
        const videoInfo = output?.images?.[0] || output?.videos?.[0] || output?.gifs?.[0];
        if (!videoInfo) throw new Error("ComfyUI returned no video output");
        const buffer = await fetchComfyFile(videoInfo.filename, videoInfo.subfolder, videoInfo.type);

        const videoPath = path.join(VIDEO_TMP_DIR, `${id}.mp4`);
        fs.writeFileSync(videoPath, buffer);
        job.videoPath = videoPath;
        job.galleryFile = saveToGallery("video", fs.readFileSync(videoPath), ".mp4");
        job.status = "done";
        console.log(`[ComfyUI Video] Job ${id} done -> ${videoPath}`);
      } catch (error: any) {
        if (job.abort?.signal.aborted) { console.log(`[ComfyUI Video] Job ${id} cancelled.`); job.status = "cancelled"; return; }
        console.error(`[ComfyUI Video] Job ${id} failed:`, error);
        job.status = "error";
        job.error = error.message;
      }
    })();
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Listen on IPv6 + IPv4 together: "localhost" resolves to ::1 first on many systems, and an IPv4-only
  // server makes every request wait for that attempt to fail (a ~2 s delay on Windows).
  const onListening = () => console.log(`Cursed Local API running on http://localhost:${PORT}`);
  const dualStack = app.listen(PORT, "::", onListening);
  dualStack.on("error", (e: any) => {
    if (e.code === "EAFNOSUPPORT" || e.code === "EADDRNOTAVAIL") app.listen(PORT, "0.0.0.0", onListening); // IPv6 off on this PC
    else throw e;
  });
}

startServer();
