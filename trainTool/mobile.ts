/**
 * HTTP surface for the Mobile side of FineTune LLM: small models trained for a phone app and exported as GGUF.
 * Separate from the PC flow: its own outputs folder (mobile_outputs), its own job ("mobile"), nothing shared but the downloaded base models.
 */
import express from "express";
import fs from "fs";
import path from "path";
import { buildMobileArgs, checkChat, cleanMobile, MOBILE_MODELS, PHONE_PRESETS, QUANTS } from "./mobileData";
import { isRunning, jobState, startProcess, stopJob } from "./jobs";
import { exists, listDirs, listFiles, resolvePaths, type TrainConfig } from "./paths";

export interface MobileOptions { appRoot: string; getConfig: () => TrainConfig }

const bad = (res: express.Response, code: number, message: string) => res.status(code).json({ error: message });
const readJson = (f: string) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

/** Parameter count in millions, guessed from the weight files and the stored precision. */
function paramsMillions(dir: string): number | null {
  let bytes = 0;
  for (const f of listFiles(dir, [".safetensors"])) bytes += f.bytes;
  if (!bytes) return null;
  const dtype = String(readJson(path.join(dir, "config.json"))?.torch_dtype || readJson(path.join(dir, "config.json"))?.dtype || "float32");
  const per = /float32|fp32/.test(dtype) ? 4 : 2;
  return Math.round(bytes / per / 1e6);
}

export function registerMobileTool(app: express.Express, opts: MobileOptions) {
  const P = () => resolvePaths(opts.getConfig(), opts.appRoot);
  const outRoot = () => path.join(P().llmRoot, "mobile_outputs");
  const llamaConvert = path.join(process.env.USERPROFILE || process.env.HOME || "", ".unsloth", "llama.cpp", "convert_hf_to_gguf.py");

  app.get("/api/mobile/status", (_req, res) => {
    const p = P();
    const models = listDirs(p.llmModelsDir).filter(n => exists(path.join(p.llmModelsDir, n, "config.json"))).map(n => ({ name: n, path: path.join(p.llmModelsDir, n), paramsM: paramsMillions(path.join(p.llmModelsDir, n)) }));
    const datasets = listFiles(p.llmDatasetsDir, [".jsonl"]).map(f => ({ ...f, rows: (() => { try { return fs.readFileSync(f.path, "utf8").split(/\r?\n/).filter(l => l.trim()).length; } catch { return 0; } })() }));
    const outputs = listDirs(outRoot()).map(n => {
      const dir = path.join(outRoot(), n);
      return { name: n, path: dir, run: readJson(path.join(dir, "run.json")), gguf: listFiles(path.join(dir, "gguf"), [".gguf"]) };
    });
    res.json({
      ready: { python: exists(p.llmPython), converter: exists(llamaConvert) },
      presets: PHONE_PRESETS, quants: QUANTS, downloads: MOBILE_MODELS,
      models, datasets, outputs, outputRoot: outRoot(), job: jobState("mobile"),
    });
  });

  /** Looks over a dataset file before training. */
  app.post("/api/mobile/dataset/check", (req, res) => {
    const f = String(req.body?.path || "");
    if (!f || !/\.jsonl$/i.test(f) || !exists(f)) return bad(res, 400, "Choose an existing .jsonl file.");
    try {
      if (fs.statSync(f).size > 200 * 1024 * 1024) return bad(res, 400, "That file is over 200 MB.");
      res.json(checkChat(fs.readFileSync(f, "utf8")));
    } catch (e: any) { bad(res, 500, e?.message || String(e)); }
  });

  app.post("/api/mobile/start", (req, res) => {
    if (isRunning("mobile")) return bad(res, 409, "A phone-model training run is already active.");
    const p = P();
    const cfg = cleanMobile(req.body);
    if (!exists(p.llmPython)) return bad(res, 400, `The Python environment was not found at ${p.llmPython}.`);
    if (!cfg.baseModelDir || !exists(path.join(cfg.baseModelDir, "config.json"))) return bad(res, 400, "Choose a downloaded base model.");
    if (!cfg.trainFile || !/\.jsonl$/i.test(cfg.trainFile) || !exists(cfg.trainFile)) return bad(res, 400, "Choose the training file (.jsonl).");
    if (cfg.testFile && !exists(cfg.testFile)) return bad(res, 400, "The test file does not exist.");
    if (cfg.quant !== "none" && !exists(llamaConvert)) return bad(res, 400, "The GGUF converter is not installed yet. Export one model with the PC side of this page once (it installs llama.cpp), or choose no export.");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    cfg.name = cfg.name || `${path.basename(cfg.baseModelDir)}-${stamp}`;
    cfg.outputDir = path.join(outRoot(), cfg.name);
    if (exists(path.join(cfg.outputDir, "run.json"))) return bad(res, 409, `A run called ${cfg.name} already exists. Choose another name.`);
    fs.mkdirSync(cfg.outputDir, { recursive: true });
    res.json(startProcess("mobile", `Training ${path.basename(cfg.baseModelDir)} for a phone (${cfg.name})`, p.llmPython, buildMobileArgs(cfg, path.join(p.scriptsDir, "train_mobile.py")), { cwd: p.scriptsDir }));
  });

  app.post("/api/mobile/stop", (_req, res) => res.json({ ok: stopJob("mobile") }));
}
