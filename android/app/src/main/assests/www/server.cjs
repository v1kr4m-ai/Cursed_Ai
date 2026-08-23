var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_vite = require("vite");
var import_node_llama_cpp = require("node-llama-cpp");
var import_transformers = require("@xenova/transformers");
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = 3e3;
  app.use(import_express.default.json());
  let llama = null;
  let modelInstance = null;
  let context = null;
  let session = null;
  let activeModelName = null;
  let isInferenceRunning = false;
  let embedder = null;
  const MEMORY_FILE = import_path.default.join(process.cwd(), "memory.json");
  let memoryStore = [];
  if (import_fs.default.existsSync(MEMORY_FILE)) {
    try {
      memoryStore = JSON.parse(import_fs.default.readFileSync(MEMORY_FILE, "utf-8"));
      console.log(`[Memory] Loaded ${memoryStore.length} entries from disk.`);
    } catch (e) {
      console.error("[Memory] Failed to load memory file", e);
    }
  }
  function saveMemory() {
    import_fs.default.writeFileSync(MEMORY_FILE, JSON.stringify(memoryStore, null, 2));
  }
  async function ensureEmbedder() {
    if (!embedder) {
      console.log("[Memory] Loading embedding model (MiniLM-L6-v2)...");
      embedder = await (0, import_transformers.pipeline)("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    }
    return embedder;
  }
  function cosineSimilarity(v1, v2) {
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
  async function getRelevantMemories(query, topK = 3) {
    const e = await ensureEmbedder();
    const output = await e(query, { pooling: "mean", normalize: true });
    const queryVector = Array.from(output.data);
    const scored = memoryStore.map((m) => ({
      ...m,
      score: cosineSimilarity(queryVector, m.vector)
    }));
    return scored.sort((a, b) => b.score - a.score).slice(0, topK).filter((m) => m.score > 0.5);
  }
  const MODELS_DIR = import_path.default.join(process.cwd(), "models");
  const ANDROID_MODELS_DIR = "/sdcard/Sunayna/models";
  async function ensureLlama() {
    if (!llama) {
      console.log("[Llama] Initializing Llama instance...");
      llama = await (0, import_node_llama_cpp.getLlama)();
    }
    return llama;
  }
  async function loadModel(modelName) {
    const l = await ensureLlama();
    let modelPath = import_path.default.join(MODELS_DIR, `${modelName}.gguf`);
    if (!import_fs.default.existsSync(modelPath)) {
      const androidPath = import_path.default.join(ANDROID_MODELS_DIR, `${modelName}.gguf`);
      if (import_fs.default.existsSync(androidPath)) {
        modelPath = androidPath;
      } else {
        const possiblePaths = [
          import_path.default.join(MODELS_DIR, modelName),
          import_path.default.join(ANDROID_MODELS_DIR, modelName)
        ];
        const found = possiblePaths.find((p) => import_fs.default.existsSync(p));
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
    session = new import_node_llama_cpp.LlamaChatSession({
      contextSequence: context.getSequence()
    });
    activeModelName = modelName;
    return modelInstance;
  }
  app.post("/api/chat", async (req, res) => {
    const { messages, prompt, model: modelName, options } = req.body;
    if (isInferenceRunning) {
      return res.status(429).json({ error: "Inference already in progress. Please wait." });
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    const abortController = new AbortController();
    req.on("close", () => {
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
      const memories = await getRelevantMemories(userQuery);
      if (memories.length > 0) {
        const contextInjection = memories.map((m) => `Relevant memory: ${m.text}`).join("\n");
        finalPrompt = `Context from user memory:
${contextInjection}

User Question: ${finalPrompt}`;
        console.log(`[LocalRuntime] Injected ${memories.length} memories into context.`);
      }
      console.log(`[LocalRuntime] Inference start: ${activeModelName} -> "${finalPrompt.slice(0, 50)}..."`);
      console.log(`[LocalRuntime] Options:`, options);
      await session.prompt(finalPrompt, {
        temperature: options?.temperature ?? 0.7,
        topP: options?.topP ?? 0.9,
        maxTokens: options?.maxTokens ?? 1024,
        signal: abortController.signal,
        onToken(chunk) {
          const token = llama.decode(chunk);
          res.write(`data: ${JSON.stringify({ token })}

`);
        }
      });
      res.write(`data: [DONE]

`);
      res.end();
    } catch (error) {
      if (error.name === "AbortError" || abortController.signal.aborted) {
        console.log("[LocalRuntime] Inference aborted successfully.");
      } else {
        console.error("[Llama Error]", error);
        res.write(`data: ${JSON.stringify({ error: error.message })}

`);
      }
      res.write(`data: [DONE]

`);
      res.end();
    } finally {
      isInferenceRunning = false;
    }
  });
  app.post("/api/memory", async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required" });
    try {
      const e = await ensureEmbedder();
      const output = await e(text, { pooling: "mean", normalize: true });
      const vector = Array.from(output.data);
      memoryStore.push({
        text,
        vector,
        timestamp: Date.now()
      });
      saveMemory();
      console.log(`[Memory] Added new entry: ${text.slice(0, 30)}...`);
      res.json({ success: true, count: memoryStore.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  app.get("/api/memory", (req, res) => {
    res.json(memoryStore.map(({ text, timestamp }) => ({ text, timestamp })));
  });
  app.get("/api/stats", (req, res) => {
    const memory = process.memoryUsage();
    res.json({
      ram: {
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024) + "MB",
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024) + "MB",
        rss: Math.round(memory.rss / 1024 / 1024) + "MB"
      },
      model: {
        active: activeModelName,
        status: isInferenceRunning ? "busy" : "idle"
      }
    });
  });
  app.get("/api/models", (req, res) => {
    const localModels = import_fs.default.existsSync(MODELS_DIR) ? import_fs.default.readdirSync(MODELS_DIR).filter((f) => f.endsWith(".gguf")) : [];
    const androidModels = import_fs.default.existsSync(ANDROID_MODELS_DIR) ? import_fs.default.readdirSync(ANDROID_MODELS_DIR).filter((f) => f.endsWith(".gguf")) : [];
    res.json({
      storage: MODELS_DIR,
      androidStorage: ANDROID_MODELS_DIR,
      active: activeModelName,
      available: Array.from(/* @__PURE__ */ new Set([...localModels, ...androidModels]))
    });
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Sunayna Local API running on http://localhost:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
