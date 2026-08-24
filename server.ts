import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
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

  app.use(express.json());

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
  interface ServerConfig { modelsDir?: string }
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

  async function ensureLlama() {
    if (!llama) {
      console.log("[Llama] Initializing Llama instance...");
      llama = await getLlama();
    }
    return llama;
  }

  function resolveModelPath(modelName: string): string {
    const candidates = [
      path.join(MODELS_DIR, `${modelName}.gguf`),
      path.join(MODELS_DIR, modelName),
    ];
    const found = candidates.find(p => fs.existsSync(p));
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
    req.on('close', () => {
      console.log("[LocalRuntime] Request closed by client. Aborting inference...");
      abortController.abort();
    });

    try {
      isInferenceRunning = true;
      await loadModel(modelName || "phi-3-mini");

      let finalPrompt = "";
      let userQuery = "";

      if (messages && messages.length > 0) {
        userQuery = messages[messages.length - 1].content;
        const history = messages.slice(0, -1);
        finalPrompt = userQuery;
        await session.setChatHistory(history);
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
        onToken(chunk: any) {
          const token = llama.decode(chunk);
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
    const localModels = fs.readdirSync(MODELS_DIR).filter(f => f.endsWith(".gguf"));
    res.json({
      storage: MODELS_DIR,
      active: activeModelName,
      available: localModels,
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

    try {
      const response = await fetch(url);
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
    const modelPath = path.join(MODELS_DIR, `${req.params.id}.gguf`);
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
    res.json({ modelsDir: MODELS_DIR, isDefault: !serverConfig.modelsDir });
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
      const result = await t(samples);
      const text = Array.isArray(result) ? result.map((r: any) => r.text).join(" ") : result.text;
      console.log(`[Voice] Transcribed ${samples.length} samples (~${(samples.length / 16000).toFixed(1)}s) -> "${(text || "").slice(0, 60)}..."`);
      res.json({ text: text || "" });
    } catch (error: any) {
      console.error("[Voice] Transcription failed:", error);
      res.status(500).json({ error: error.message });
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
      res.json({ src: `data:${img.mimeType || "image/png"};base64,${img.imageBytes}` });
    } catch (error: any) {
      console.error("[Image] Generation failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route: Video generation (Gemini/Veo — real, async job since it takes minutes)
  interface VideoJobInternal {
    id: string;
    prompt: string;
    status: "pending" | "done" | "error";
    videoPath?: string;
    error?: string;
    createdAt: number;
  }
  const videoJobs = new Map<string, VideoJobInternal>();
  const VIDEO_TMP_DIR = path.join(os.tmpdir(), "sunayna-videos");
  fs.mkdirSync(VIDEO_TMP_DIR, { recursive: true });

  app.post("/api/video/generate", (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt is required" });

    const id = Date.now().toString();
    const job: VideoJobInternal = { id, prompt, status: "pending", createdAt: Date.now() };
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
          await new Promise(resolve => setTimeout(resolve, 10000));
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
        job.status = "done";
        console.log(`[Video] Job ${id} done -> ${videoPath}`);
      } catch (error: any) {
        console.error(`[Video] Job ${id} failed:`, error);
        job.status = "error";
        job.error = error.message;
      }
    })();
  });

  app.get("/api/video/status/:id", (req, res) => {
    const job = videoJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json({
      id: job.id,
      status: job.status,
      error: job.error,
      resultUrl: job.status === "done" ? `/api/video/result/${job.id}` : undefined,
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Sunayna Local API running on http://localhost:${PORT}`);
  });
}

startServer();
