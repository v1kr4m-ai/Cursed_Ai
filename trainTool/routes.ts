/**
 * HTTP surface for the Train LoRA and FineTune LLM pages.
 *   Train LoRA:    dataset folders (images + captions), character sketches through ComfyUI, auto-captioning, kohya Flux LoRA training.
 *   FineTune LLM:  instruction datasets (by hand, or built from PDFs / Word / images / URLs), Unsloth QLoRA training, GGUF export to Ollama.
 * Every long job goes through jobs.ts so its log survives page changes.
 */
import express from "express";
import fs from "fs";
import path from "path";
import { buildLlmArgs, buildLoraArgs, cleanLlm, cleanLora, writeLoraToml } from "./builders";
import { freeVram, isRunning, jobState, startProcess, startTask, stopJob, subscribeAll, type JobKind } from "./jobs";
import { exists, listDirs, listFiles, listHfModels, resolvePaths, type TrainConfig } from "./paths";
import { buildDataset, triggerFor } from "./personDataset";
import { createSeriesStore } from "../seriesTool/store";
import { chunkText, describeWithOllama, pairsFromChunk, sourceText, VISION_HINT, type Source } from "./sources";

export interface TrainOptions {
  appRoot: string;
  /** Where uploaded source files go. */
  dataDir: string;
  getConfig: () => TrainConfig;
  setConfig: (c: TrainConfig) => void;
  comfyUrl: string;
  ollamaUrl: string;
  geminiKey: () => string | undefined;
  getComfyRoot: () => string | undefined;
}

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const KINDS: JobKind[] = ["lora", "llm", "caption", "sketch", "pairs", "download"];
const bad = (res: express.Response, code: number, message: string) => res.status(code).json({ error: message });

export function registerTrainTool(app: express.Express, opts: TrainOptions) {
  const P = () => resolvePaths(opts.getConfig(), opts.appRoot);
  const ollamaModels = async (): Promise<string[]> => {
    try { return ((await (await fetch(`${opts.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2500) })).json()) as any).models.map((m: any) => m.name); } catch { return []; }
  };
  const comfyUp = async () => { try { return (await fetch(`${opts.comfyUrl}/system_stats`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };

  const imageEntries = (dir: string, limit = 400) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile() && IMAGE_EXT.test(d.name)).slice(0, limit).map(d => {
        const img = path.join(dir, d.name);
        let caption = "";
        try { caption = fs.readFileSync(path.join(dir, path.parse(d.name).name + ".txt"), "utf8").trim(); } catch { /* not captioned yet */ }
        return { name: d.name, path: img, caption };
      });
    } catch { return []; }
  };
  const lineCount = (f: string) => { try { return fs.readFileSync(f, "utf8").split(/\r?\n/).filter(l => l.trim()).length; } catch { return 0; } };

  /** Everything the pages need to draw themselves: paths, what is installed, what is running. */
  app.get("/api/train/status", async (_req, res) => {
    const p = P();
    const models = await ollamaModels();
    const missing: string[] = [];
    for (const [label, f] of [["Flux checkpoint (flux1-dev.sft)", p.fluxUnet], ["clip_l", p.fluxClipL], ["t5xxl", p.fluxT5], ["VAE (ae.sft)", p.fluxVae], ["kohya sd-scripts", p.sdScripts], ["accelerate", p.fluxAccelerate]] as const) if (!exists(f)) missing.push(label);
    const jobs: Record<string, unknown> = {};
    for (const k of KINDS) jobs[k] = jobState(k);
    res.json({
      paths: p, jobs,
      lora: {
        ready: !missing.length, missing,
        baseModels: listFiles(p.fluxUnetDir, [".sft", ".safetensors", ".gguf"]),
        datasets: listDirs(p.fluxDatasetsDir).map(n => ({ name: n, path: path.join(p.fluxDatasetsDir, n), images: imageEntries(path.join(p.fluxDatasetsDir, n), 5000).length })),
        outputDir: p.fluxOutputDir,
      },
      llm: {
        ready: exists(p.llmPython) && exists(`${p.scriptsDir}/train_llm.py`), pythonFound: exists(p.llmPython),
        baseModels: listHfModels(p.llmModelsDir),
        datasets: listFiles(p.llmDatasetsDir, [".jsonl"]).map(f => ({ ...f, examples: lineCount(f.path) })),
        outputDir: p.llmOutputDir,
        outputs: listDirs(p.llmOutputDir).map(n => ({ name: n, path: path.join(p.llmOutputDir, n), hasAdapter: exists(path.join(p.llmOutputDir, n, "adapter")), gguf: listFiles(path.join(p.llmOutputDir, n, "gguf"), [".gguf"]) })),
      },
      comfy: { running: await comfyUp(), url: opts.comfyUrl },
      ollama: { running: models.length > 0 || (await fetch(`${opts.ollamaUrl}/api/version`, { signal: AbortSignal.timeout(1500) }).then(r => r.ok).catch(() => false)), models, vision: models.filter(m => VISION_HINT.test(m)) },
      gemini: !!opts.geminiKey(),
      comfyRoot: opts.getComfyRoot() || null,
    });
  });

  app.post("/api/train/paths", (req, res) => {
    const cur = opts.getConfig();
    const next: TrainConfig = { ...cur };
    for (const k of ["trainRoot", "fluxgymRoot"] as const) {
      const v = req.body?.[k];
      if (typeof v === "string") { if (v.trim() && !exists(v.trim())) return bad(res, 400, `That folder does not exist: ${v}`); next[k] = v.trim() || undefined; }
    }
    opts.setConfig(next);
    res.json({ ok: true, paths: P() });
  });

  app.get("/api/train/events", (_req, res) => subscribeAll(res));
  for (const k of KINDS) app.post(`/api/train/${k}/stop`, (_req, res) => res.json({ ok: stopJob(k) }));

  // ------------------------------------------------------------------ LoRA

  app.post("/api/train/lora/start", async (req, res) => {
    if (isRunning("lora")) return bad(res, 409, "A LoRA training run is already active.");
    const cfg = cleanLora(req.body);
    const p = P();
    if (!cfg.triggerWord) return bad(res, 400, "Give the character a trigger word (letters, numbers, - and _).");
    if (!cfg.datasetDir || !exists(cfg.datasetDir)) return bad(res, 400, "Choose a dataset folder that exists.");
    if (!imageEntries(cfg.datasetDir, 1).length) return bad(res, 400, "That dataset folder has no images.");
    if (!cfg.outputDir) cfg.outputDir = path.join(p.fluxOutputDir, cfg.triggerWord);
    for (const [label, f] of [["FluxGym's accelerate", p.fluxAccelerate], ["kohya sd-scripts", p.sdScripts]] as const) if (!exists(f)) return bad(res, 400, `${label} was not found at ${f}. Set the FluxGym folder in the page.`);
    fs.mkdirSync(cfg.outputDir, { recursive: true });
    const toml = writeLoraToml(cfg);
    const state = startProcess("lora", `Training LoRA "${cfg.triggerWord}" (${cfg.epochs} epochs, ${cfg.vramPreset})`, p.fluxAccelerate, buildLoraArgs(cfg, p, toml), { cwd: p.sdScripts });
    // ComfyUI and Ollama keep models in VRAM until told otherwise, which starves training.
    freeVram({ comfyUrl: opts.comfyUrl, ollamaUrl: opts.ollamaUrl }, () => {});
    res.json(state);
  });

  app.get("/api/train/images", (req, res) => {
    const dir = String(req.query.dir || "");
    if (!dir || !exists(dir)) return res.json({ images: [] });
    res.json({ images: imageEntries(dir, Number(req.query.limit) || 400) });
  });

  app.get("/api/train/image", (req, res) => {
    const file = path.resolve(String(req.query.path || ""));
    if (!IMAGE_EXT.test(file) || !exists(file)) return bad(res, 404, "No such image.");
    res.sendFile(file);
  });

  app.put("/api/train/caption", (req, res) => {
    const img = String(req.body?.path || "");
    if (!IMAGE_EXT.test(img) || !exists(img)) return bad(res, 404, "No such image.");
    fs.writeFileSync(path.join(path.dirname(img), path.parse(img).name + ".txt"), String(req.body?.caption ?? ""), "utf8");
    res.json({ ok: true });
  });

  app.delete("/api/train/image", (req, res) => {
    const img = String(req.query.path || "");
    if (!IMAGE_EXT.test(img) || !exists(img)) return bad(res, 404, "No such image.");
    fs.unlinkSync(img);
    try { fs.unlinkSync(path.join(path.dirname(img), path.parse(img).name + ".txt")); } catch { /* had no caption */ }
    res.json({ ok: true });
  });

  /** Builds a LoRA dataset from the photos of one person in a Series project (a person is a name shared by that person's pictures). */
  app.post("/api/train/lora/from-series", (req, res) => {
    const person = String(req.body?.person || "").trim();
    const project = createSeriesStore(path.join(opts.appRoot, "series")).get(String(req.body?.projectId || ""));
    if (!project) return bad(res, 404, "No such series.");
    if (!person) return bad(res, 400, "Choose a person.");
    const photos = [...new Set(project.episodes.flatMap(ep => ep.refs)
      .filter(r => !!r.file && !r.prompt.trim() && !r.skip && (r.person || "").trim().toLowerCase() === person.toLowerCase())
      .map(r => r.file as string))];
    if (!photos.length) return bad(res, 400, `${person} has no attached photos. Attach some in Develop > Reference photos, with that person's name.`);
    const trigger = triggerFor(person);
    const result = buildDataset({ dir: path.join(P().fluxDatasetsDir, trigger), trigger, photos });
    res.json({ ...result, name: trigger, enough: result.total >= 10, person });
  });

  app.post("/api/train/dataset/create", (req, res) => {
    const name = String(req.body?.name || "").replace(/[^\w -]/g, "").trim();
    if (!name) return bad(res, 400, "Give the dataset a name.");
    const dir = path.join(P().fluxDatasetsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    res.json({ name, path: dir });
  });

  app.post("/api/train/images/upload", express.raw({ type: "*/*", limit: "60mb" }), (req, res) => {
    const dir = String(req.query.dir || "");
    const name = String(req.query.name || "image.png").replace(/[\\/:*?"<>|]/g, "_");
    if (!dir) return bad(res, 400, "Choose a dataset folder first.");
    if (!IMAGE_EXT.test(name) || !Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 400, "That is not an image.");
    fs.mkdirSync(dir, { recursive: true });
    let target = path.join(dir, name);
    for (let n = 2; exists(target); n++) target = path.join(dir, `${path.parse(name).name}_${n}${path.extname(name)}`);
    fs.writeFileSync(target, req.body);
    res.json({ path: target });
  });

  /** Captions for every image that has none: Florence-2 (FluxGym's environment) or an Ollama vision model. */
  app.post("/api/train/caption/start", (req, res) => {
    if (isRunning("caption")) return bad(res, 409, "Captioning is already running.");
    const dir = String(req.body?.datasetDir || "");
    const trigger = String(req.body?.triggerWord || "").replace(/[^\w-]/g, "");
    const overwrite = !!req.body?.overwrite;
    if (!dir || !exists(dir)) return bad(res, 400, "Choose a dataset folder that exists.");
    const p = P();
    const model = String(req.body?.model || "");
    if (model) {
      return res.json(startTask("caption", `Captioning with ${model}`, async ctx => {
        const todo = imageEntries(dir, 5000).filter(i => overwrite || !i.caption);
        if (!todo.length) { ctx.log("Every image already has a caption. Tick \"redo existing\" to caption them again."); return { done: 0 }; }
        let n = 0;
        for (const img of todo) {
          if (ctx.signal.aborted) break;
          ctx.log(`${n + 1}/${todo.length}: ${img.name}`);
          ctx.progress(Math.round((n / todo.length) * 100), `${n}/${todo.length}`);
          const text = await describeWithOllama(opts.ollamaUrl, model, img.path, "Describe this image in one detailed sentence for an AI image training caption: the subject, their look and clothing, pose, setting, lighting and style. No preamble, no quotes.");
          const clean = text.replace(/^["']|["']$/g, "").replace(/^(the|this) (image|photo|photograph|picture) (is|shows|depicts|features|captures) (a |an )?(photograph|photo|picture|image)?( of)?\s*/i, "").replace(/^an? (image|photo|photograph|picture) of\s+/i, "").trim();
          if (!clean) { ctx.log("  the model sent back nothing for this picture - skipped (a different vision model may do better)"); continue; }
          fs.writeFileSync(path.join(dir, path.parse(img.name).name + ".txt"), trigger ? `${trigger}, ${clean}` : clean, "utf8");
          n++;
        }
        ctx.progress(100, `${n}/${todo.length}`);
        return { done: n };
      }));
    }
    if (!exists(p.fluxPython)) return bad(res, 400, `FluxGym's Python was not found at ${p.fluxPython}. Pick an Ollama vision model instead, or set the FluxGym folder.`);
    const args = [`${p.scriptsDir}/caption_images.py`, "--dir", dir, "--trigger", trigger];
    if (overwrite) args.push("--overwrite");
    res.json(startProcess("caption", "Captioning with Florence-2", p.fluxPython, args));
  });

  /** A quick Flux text-to-image pass through ComfyUI, straight into the dataset folder with the caption filled in. */
  app.post("/api/train/sketch/start", async (req, res) => {
    if (isRunning("sketch")) return bad(res, 409, "A generation is already running.");
    const trigger = String(req.body?.triggerWord || "").replace(/[^\w-]/g, "");
    const prompt = String(req.body?.prompt || "").trim();
    const dir = String(req.body?.datasetDir || "");
    const count = Math.min(40, Math.max(1, Math.round(Number(req.body?.count) || 4)));
    const size = Math.min(1536, Math.max(512, Math.round(Number(req.body?.resolution) || 1024)));
    if (!trigger || !prompt || !dir) return bad(res, 400, "A trigger word, a prompt and a dataset folder are needed.");
    if (!(await comfyUp())) return bad(res, 400, "ComfyUI is not running. Start it from the Image page or the button here.");
    res.json(startTask("sketch", `Generating ${count} character image${count === 1 ? "" : "s"}`, async ctx => {
      fs.mkdirSync(dir, { recursive: true });
      const names = await comfyModelNames(opts.comfyUrl);
      ctx.log(`using ${names.unet}, ${names.t5}, ${names.clipL}, ${names.vae}`);
      const saved: string[] = [];
      for (let i = 0; i < count; i++) {
        if (ctx.signal.aborted) break;
        const seed = (Number.isFinite(Number(req.body?.seed)) ? Number(req.body.seed) : Math.floor(Math.random() * 1e9)) + i;
        ctx.log(`image ${i + 1}/${count} (seed ${seed})...`);
        ctx.progress(Math.round((i / count) * 100), `${i}/${count}`);
        const id = await queueComfy(opts.comfyUrl, fluxWorkflow({ ...names, prompt: `${trigger}, ${prompt}`, seed, steps: 25, width: size, height: size, prefix: `character_sketch/${trigger}` }));
        const images = await waitComfy(opts.comfyUrl, id, ctx.log, ctx.signal);
        for (const im of images) {
          const r = await fetch(`${opts.comfyUrl}/view?filename=${encodeURIComponent(im.filename)}&subfolder=${encodeURIComponent(im.subfolder || "")}&type=${im.type || "output"}`);
          if (!r.ok) throw new Error(`Could not fetch the image from ComfyUI (${r.status}).`);
          const base = `${trigger}_sketch_${Date.now()}_${i}`;
          const file = path.join(dir, base + (path.extname(im.filename) || ".png"));
          fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
          fs.writeFileSync(path.join(dir, base + ".txt"), `${trigger}, ${prompt}`, "utf8");
          saved.push(file);
          ctx.log(`saved ${path.basename(file)}`);
        }
      }
      ctx.progress(100, `${saved.length}/${count}`);
      return { saved };
    }));
  });

  /** Copy a trained LoRA into ComfyUI's loras folder. */
  app.post("/api/train/lora/install", (req, res) => {
    const file = String(req.body?.file || "");
    const root = opts.getComfyRoot();
    if (!file.toLowerCase().endsWith(".safetensors") || !exists(file)) return bad(res, 404, "No such LoRA file.");
    if (!root) return bad(res, 400, "ComfyUI's folder is not set - choose it on the Image page.");
    const candidates = [path.join(root, "ComfyUI", "models", "loras"), path.join(root, "models", "loras")];
    const dir = candidates.find(exists);
    if (!dir) return bad(res, 400, `No models/loras folder found under ${root}.`);
    fs.copyFileSync(file, path.join(dir, path.basename(file)));
    res.json({ ok: true, to: path.join(dir, path.basename(file)) });
  });

  app.get("/api/train/lora/files", (req, res) => {
    const dir = String(req.query.dir || "");
    res.json({ files: dir && exists(dir) ? listFiles(dir, [".safetensors"]) : [] });
  });

  // ------------------------------------------------------------------ LLM

  app.post("/api/train/llm/start", async (req, res) => {
    if (isRunning("llm")) return bad(res, 409, "A fine-tune is already running.");
    const cfg = cleanLlm(req.body);
    const p = P();
    if (!exists(p.llmPython)) return bad(res, 400, `The fine-tuning Python environment was not found at ${p.llmPython}. Set the training folder in the page.`);
    if (!cfg.baseModelDir || !exists(path.join(cfg.baseModelDir, "config.json"))) return bad(res, 400, "Choose a downloaded base model.");
    if (!cfg.datasetFile || !exists(cfg.datasetFile)) return bad(res, 400, "Choose a training dataset (.jsonl).");
    if (!cfg.outputDir) cfg.outputDir = path.join(p.llmOutputDir, `${path.basename(cfg.baseModelDir)}-${new Date().toISOString().slice(0, 10)}`);
    fs.mkdirSync(cfg.outputDir, { recursive: true });
    const state = startProcess("llm", `Fine-tuning ${path.basename(cfg.baseModelDir)} on ${path.basename(cfg.datasetFile)}`, p.llmPython, buildLlmArgs(cfg, `${p.scriptsDir}/train_llm.py`), { cwd: p.llmRoot });
    freeVram({ comfyUrl: opts.comfyUrl, ollamaUrl: opts.ollamaUrl }, () => {});
    res.json(state);
  });

  /** Download a 4-bit base model into the models folder (the one step that needs internet). */
  app.post("/api/train/llm/download", (req, res) => {
    if (isRunning("download")) return bad(res, 409, "A download is already running.");
    const repo = String(req.body?.repo || "").trim();
    const p = P();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return bad(res, 400, "Use a Hugging Face name like unsloth/Phi-3.5-mini-instruct-bnb-4bit.");
    if (!exists(p.llmPython)) return bad(res, 400, "The fine-tuning Python environment was not found.");
    fs.mkdirSync(p.llmModelsDir, { recursive: true });
    res.json(startProcess("download", `Downloading ${repo}`, p.llmPython, ["-c", "import sys; from huggingface_hub import snapshot_download as d; d(sys.argv[1], local_dir=sys.argv[2])", repo, path.join(p.llmModelsDir, repo.split("/")[1])]));
  });

  /** Make a fine-tuned GGUF available in Ollama. */
  app.post("/api/train/llm/register", (req, res) => {
    if (isRunning("download")) return bad(res, 409, "Another task is running.");
    const gguf = String(req.body?.gguf || "");
    const name = String(req.body?.name || "").replace(/[^\w.:/-]/g, "");
    if (!gguf.toLowerCase().endsWith(".gguf") || !exists(gguf)) return bad(res, 404, "No such GGUF file.");
    if (!name) return bad(res, 400, "Give the Ollama model a name.");
    const modelfile = path.join(path.dirname(gguf), "Modelfile");
    fs.writeFileSync(modelfile, `FROM ${gguf}\n`, "utf8");
    res.json(startProcess("download", `ollama create ${name}`, "ollama", ["create", name, "-f", modelfile], { onExit: code => { if (code === 0) fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/external-models`).catch(() => {}); } }));
  });

  app.post("/api/train/llm/dataset/save", (req, res) => {
    const p = P();
    const name = String(req.body?.fileName || "").replace(/[^\w -]/g, "").trim().replace(/\.jsonl$/i, "");
    const examples: any[] = Array.isArray(req.body?.examples) ? req.body.examples : [];
    if (!name) return bad(res, 400, "Give the file a name.");
    const rows = examples.filter(e => e && String(e.instruction || "").trim() && String(e.output || "").trim()).map(e => ({ instruction: String(e.instruction).trim(), input: String(e.input || "").trim(), output: String(e.output).trim() }));
    if (!rows.length) return bad(res, 400, "There are no complete examples to save.");
    fs.mkdirSync(p.llmDatasetsDir, { recursive: true });
    const file = path.join(p.llmDatasetsDir, `${name}.jsonl`);
    fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join("\n") + "\n", "utf8");
    res.json({ file, count: rows.length });
  });

  app.post("/api/train/llm/dataset/load", (req, res) => {
    const file = String(req.body?.path || "");
    if (!file.toLowerCase().endsWith(".jsonl") || !exists(file)) return bad(res, 404, "No such dataset.");
    try {
      const examples = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l)).map(e => ({ instruction: String(e.instruction || ""), input: String(e.input || ""), output: String(e.output || "") }));
      res.json({ examples });
    } catch (e: any) { bad(res, 400, `That file is not valid .jsonl: ${e.message}`); }
  });

  /** A source file from the browser (PDF, Word, image). */
  app.post("/api/train/source/upload", express.raw({ type: "*/*", limit: "120mb" }), (req, res) => {
    const name = String(req.query.name || "file").replace(/[\\/:*?"<>|]/g, "_");
    if (!Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 400, "No file received.");
    const ext = path.extname(name).toLowerCase();
    const type = ext === ".pdf" ? "pdf" : ext === ".docx" ? "docx" : IMAGE_EXT.test(ext) ? "image" : ext === ".txt" || ext === ".md" ? "text" : "";
    if (!type) return bad(res, 400, "Use a PDF, a Word (.docx) file, an image, or a .txt / .md file.");
    const dir = path.join(opts.dataDir, "train", "sources");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now().toString(36)}_${name}`);
    fs.writeFileSync(file, req.body);
    res.json({ type: type === "text" ? "text" : type, value: type === "text" ? req.body.toString("utf8") : file, label: name });
  });

  app.post("/api/train/source/preview", async (req, res) => {
    const s = req.body as Source;
    try { const text = await sourceText(s, P(), { ollamaUrl: opts.ollamaUrl, visionModel: req.body?.visionModel }); res.json({ text, chars: text.trim().length }); }
    catch (e: any) { bad(res, 500, e?.message || String(e)); }
  });

  app.get("/api/train/pair-models", async (_req, res) => {
    const models = await ollamaModels();
    res.json({ ollama: models.filter(m => !/embed/i.test(m)), vision: models.filter(m => VISION_HINT.test(m)), gemini: !!opts.geminiKey() });
  });

  app.post("/api/train/pairs/start", (req, res) => {
    if (isRunning("pairs")) return bad(res, 409, "Pairs are already being generated.");
    const sources: Source[] = Array.isArray(req.body?.sources) ? req.body.sources : [];
    const modelValue = String(req.body?.model || "");
    const count = Math.min(20, Math.max(1, Math.round(Number(req.body?.count) || 5)));
    const topic = String(req.body?.topic || "");
    if (!sources.length) return bad(res, 400, "Add at least one source.");
    if (!modelValue) return bad(res, 400, "Choose the model that writes the pairs.");
    const sep = modelValue.indexOf("::");
    const provider = sep < 0 ? "ollama" : modelValue.slice(0, sep);
    const model = sep < 0 ? modelValue : modelValue.slice(sep + 2);
    const visionModel = String(req.body?.visionModel || "") || undefined;
    res.json(startTask("pairs", `Writing pairs from ${sources.length} source${sources.length === 1 ? "" : "s"} with ${model}`, async ctx => {
      const examples: any[] = [];
      let rejected = 0;
      for (const s of sources) {
        if (ctx.signal.aborted) break;
        ctx.log(`reading ${s.label}`);
        let text = "";
        try { text = (await sourceText(s, P(), { ollamaUrl: opts.ollamaUrl, visionModel })).trim(); } catch (e: any) { ctx.log(`  could not read it: ${e.message}`); continue; }
        if (!text) { ctx.log("  no text found, skipping."); continue; }
        ctx.log(`  ${text.length.toLocaleString()} characters.`);
        if (text.length < 200) ctx.log("  Very little text - a scanned PDF has no text layer, and the model may invent filler from so little.");
        const chunks = chunkText(text, 3000);
        for (let i = 0; i < chunks.length; i++) {
          if (ctx.signal.aborted) break;
          ctx.progress(Math.round((i / chunks.length) * 100), `chunk ${i + 1}/${chunks.length} of ${s.label}`);
          try {
            const r = await pairsFromChunk(provider, model, chunks[i], count, topic, { ollamaUrl: opts.ollamaUrl, geminiKey: opts.geminiKey() });
            examples.push(...r.kept); rejected += r.rejected;
            ctx.log(`  chunk ${i + 1}/${chunks.length}: +${r.kept.length}${r.rejected ? ` (${r.rejected} filtered as filler)` : ""} - total ${examples.length}`);
          } catch (e: any) { ctx.log(`  chunk ${i + 1}/${chunks.length} failed: ${e.message}`); }
        }
      }
      ctx.log(`${examples.length} pairs written${rejected ? `, ${rejected} filtered out as low quality` : ""}.`);
      ctx.progress(100, `${examples.length} pairs`);
      return { examples };
    }));
  });
}

// ---------------------------------------------------------------- ComfyUI helpers

async function comfyModelNames(url: string) {
  const list = async (node: string, field: string): Promise<string[]> => {
    try { const d: any = await (await fetch(`${url}/object_info/${node}`, { signal: AbortSignal.timeout(6000) })).json(); return d?.[node]?.input?.required?.[field]?.[0] || []; } catch { return []; }
  };
  const unets = await list("UNETLoader", "unet_name");
  const clips = await list("DualCLIPLoader", "clip_name1");
  const vaes = await list("VAELoader", "vae_name");
  const pick = (l: string[], ...res: RegExp[]) => { for (const re of res) { const f = l.find(x => re.test(x)); if (f) return f; } return ""; };
  const names = {
    unet: pick(unets, /flux.*dev/i, /flux/i), t5: pick(clips, /t5xxl.*fp16/i, /t5xxl/i), clipL: pick(clips, /clip_l/i), vae: pick(vaes, /^ae\./i, /flux.*vae|ae/i),
  };
  const missing = Object.entries({ "a Flux checkpoint": names.unet, "t5xxl": names.t5, "clip_l": names.clipL, "the Flux VAE (ae)": names.vae }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`ComfyUI does not have ${missing.join(", ")} installed, so Flux cannot generate here. Use \"Open ComfyUI\" and your own workflow, then Import images.`);
  return names;
}

function fluxWorkflow(o: { unet: string; t5: string; clipL: string; vae: string; prompt: string; seed: number; steps: number; width: number; height: number; prefix: string }) {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: o.unet, weight_dtype: "default" } },
    "2": { class_type: "DualCLIPLoader", inputs: { clip_name1: o.t5, clip_name2: o.clipL, type: "flux" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: o.vae } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: o.prompt, clip: ["2", 0] } },
    "5": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } },
    "6": { class_type: "FluxGuidance", inputs: { conditioning: ["4", 0], guidance: 3.5 } },
    "7": { class_type: "EmptySD3LatentImage", inputs: { width: o.width, height: o.height, batch_size: 1 } },
    "8": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["6", 0], negative: ["5", 0], latent_image: ["7", 0], seed: o.seed, steps: o.steps, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise: 1.0 } },
    "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "10": { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: o.prefix } },
  };
}

async function queueComfy(url: string, workflow: unknown): Promise<string> {
  const r = await fetch(`${url}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow, client_id: "cursed-train" }) });
  if (!r.ok) throw new Error(`ComfyUI refused the job (${r.status}): ${(await r.text()).slice(0, 300)}`);
  return ((await r.json()) as any).prompt_id;
}

/** A Flux image can take minutes on a small card, so wait long and say so now and then. */
async function waitComfy(url: string, id: string, log: (t: string) => void, signal: AbortSignal): Promise<{ filename: string; subfolder: string; type: string }[]> {
  const started = Date.now();
  let lastNote = 0;
  while (Date.now() - started < 25 * 60_000) {
    if (signal.aborted) return [];
    try {
      const d: any = await (await fetch(`${url}/history/${id}`)).json();
      const e = d?.[id];
      if (e?.status?.status_str === "error") throw new Error(`ComfyUI reported an error: ${(e.status.messages || []).map((m: any) => (Array.isArray(m) ? JSON.stringify(m[1]) : String(m))).join("; ").slice(0, 300) || "unknown"}`);
      const imgs = Object.values(e?.outputs || {}).flatMap((o: any) => o.images || []);
      if (imgs.length) return imgs as any;
    } catch (err: any) { if (/ComfyUI reported/.test(err?.message)) throw err; }
    if (Date.now() - lastNote > 20000) { lastNote = Date.now(); log(`  still generating... ${Math.round((Date.now() - started) / 1000)}s (large model on a small card - normal)`); }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error("Timed out waiting for ComfyUI. Check its own window for a stuck node.");
}
