import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { createServer as createViteServer } from "vite";
import { getLlama, LlamaChatSession } from "node-llama-cpp";
import { pipeline } from "@xenova/transformers";

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
  const PORT = 3000;

  app.use(express.json());

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

  async function ensureEmbedder() {
    if (!embedder) {
      console.log("[Memory] Loading embedding model (MiniLM-L6-v2)...");
      embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    }
    return embedder;
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

  const MODELS_DIR = path.join(process.cwd(), "models");
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
