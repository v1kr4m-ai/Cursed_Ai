import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { getLlama, LlamaChatSession } from "node-llama-cpp";
import { pipeline } from "@xenova/transformers";

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
  const ANDROID_MODELS_DIR = "/sdcard/Sunayna/models";

  async function ensureLlama() {
    if (!llama) {
      console.log("[Llama] Initializing Llama instance...");
      llama = await getLlama();
    }
    return llama;
  }

  async function loadModel(modelName: string) {
    const l = await ensureLlama();
    
    let modelPath = path.join(MODELS_DIR, `${modelName}.gguf`);
    if (!fs.existsSync(modelPath)) {
        // Fallback to android path if it exists
        const androidPath = path.join(ANDROID_MODELS_DIR, `${modelName}.gguf`);
        if (fs.existsSync(androidPath)) {
            modelPath = androidPath;
        } else {
            // Check if it's just the name without extension
            const possiblePaths = [
                path.join(MODELS_DIR, modelName),
                path.join(ANDROID_MODELS_DIR, modelName)
            ];
            const found = possiblePaths.find(p => fs.existsSync(p));
            if (found) {
                modelPath = found;
            } else {
                throw new Error(`Model ${modelName} not found in ${MODELS_DIR} or ${ANDROID_MODELS_DIR}`);
            }
        }
    }

    if (activeModelName === modelName && modelInstance) {
      return modelInstance;
    }

    console.log(`[Llama] Loading model: ${modelPath}`);
    modelInstance = await l.loadModel({ modelPath });
    context = await modelInstance.createContext();
    session = new LlamaChatSession({ 
      contextSequence: context.getSequence() 
    });
    activeModelName = modelName;
    return modelInstance;
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

      // RAG: Inject relevant memories
      const memories = await getRelevantMemories(userQuery);
      if (memories.length > 0) {
        const contextInjection = memories.map(m => `Relevant memory: ${m.text}`).join("\n");
        finalPrompt = `Context from user memory:\n${contextInjection}\n\nUser Question: ${finalPrompt}`;
        console.log(`[LocalRuntime] Injected ${memories.length} memories into context.`);
      }

      console.log(`[LocalRuntime] Inference start: ${activeModelName} -> "${finalPrompt.slice(0, 50)}..."`);
      console.log(`[LocalRuntime] Options:`, options);

      await session.prompt(finalPrompt, {
        temperature: options?.temperature ?? 0.7,
        topP: options?.topP ?? 0.9,
        maxTokens: options?.maxTokens ?? 1024,
        signal: abortController.signal,
        onToken(chunk: any) {
          const token = llama.decode(chunk);
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
      });

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

  // API Route: Memory and Resource Stats
  app.get("/api/stats", (req, res) => {
    const memory = process.memoryUsage();
    res.json({
      ram: {
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024) + "MB",
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024) + "MB",
        rss: Math.round(memory.rss / 1024 / 1024) + "MB",
      },
      model: {
        active: activeModelName,
        status: isInferenceRunning ? "busy" : "idle"
      }
    });
  });

  // API Route: Model Management
  app.get("/api/models", (req, res) => {
    const localModels = fs.existsSync(MODELS_DIR) ? fs.readdirSync(MODELS_DIR).filter(f => f.endsWith(".gguf")) : [];
    const androidModels = fs.existsSync(ANDROID_MODELS_DIR) ? fs.readdirSync(ANDROID_MODELS_DIR).filter(f => f.endsWith(".gguf")) : [];
    
    res.json({
      storage: MODELS_DIR,
      androidStorage: ANDROID_MODELS_DIR,
      active: activeModelName,
      available: Array.from(new Set([...localModels, ...androidModels]))
    });
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
