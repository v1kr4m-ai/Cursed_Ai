/**
 * Face swap with FaceFusion, kept inside the app (faceswap/facefusion with its own Python environment in faceswap/env).
 * Puts the face from one or more source photos onto a target picture or video; runs in the background as the "faceswap" job.
 */
import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { freeVram, isRunning, startProcess, stopJob } from "./jobs";
import { exists } from "./paths";

export interface FaceSwapOptions { appRoot: string; comfyUrl: string; ollamaUrl: string }

const IMAGE_RE = /\.(png|jpe?g|webp|bmp)$/i;
const VIDEO_RE = /\.(mp4|webm|mov|mkv|avi)$/i;
const MIME: Record<string, string> = { ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo" };
/** FaceFusion model families, by the start of the model file's name. */
const SWAPPERS = /^(hyperswap|inswapper|simswap|ghost|blendswap|uniface|hififace)/i;
const ENHANCERS = /^(gfpgan|codeformer|gpen|restoreformer)/i;

export interface FaceSwapRequest {
  sources: string[]; target: string; output: string;
  model: string; enhancer?: string; allFaces?: boolean; ffDir: string; script: string;
}

/** The arguments for one FaceFusion run (headless, on the GPU). */
export function buildFaceSwapArgs(r: FaceSwapRequest): string[] {
  const processors = ["face_swapper", ...(r.enhancer ? ["face_enhancer"] : [])];
  return [
    r.script, r.ffDir, "headless-run",
    "--source-paths", ...r.sources, "--target-path", r.target, "--output-path", r.output,
    "--processors", ...processors, "--face-swapper-model", r.model,
    ...(r.enhancer ? ["--face-enhancer-model", r.enhancer] : []),
    "--face-selector-mode", r.allFaces ? "many" : "one",
    "--execution-providers", "cuda", "--output-video-quality", "90",
    "--temp-path", path.join(path.dirname(r.output), ".temp"),
  ];
}

export function registerFaceSwap(app: express.Express, opts: FaceSwapOptions) {
  const root = path.join(opts.appRoot, "faceswap");
  const ffDir = path.join(root, "facefusion");
  const python = path.join(root, "env", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
  const script = path.join(opts.appRoot, "trainTool", "scripts", "facefusion_run.py");
  const outDir = path.join(opts.appRoot, "outputs", "faceswap");
  const models = (re: RegExp) => { try { return fs.readdirSync(path.join(ffDir, ".assets", "models")).filter(n => n.endsWith(".onnx") && re.test(n)).map(n => n.replace(/\.onnx$/, "")).sort(); } catch { return []; } };
  const results = () => { try { return fs.readdirSync(outDir).filter(n => IMAGE_RE.test(n) || VIDEO_RE.test(n)).map(n => path.join(outDir, n)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs).slice(0, 60); } catch { return []; } };

  app.get("/api/faceswap/status", (_req, res) => {
    const missing = [!exists(python) && "its Python environment (faceswap/env)", !exists(path.join(ffDir, "facefusion.py")) && "FaceFusion (faceswap/facefusion)"].filter(Boolean);
    res.json({ ready: !missing.length, missing, swappers: models(SWAPPERS), enhancers: models(ENHANCERS), outputDir: outDir, results: results(), running: isRunning("faceswap") });
  });

  app.post("/api/faceswap/start", async (req, res) => {
    if (isRunning("faceswap")) return res.status(409).json({ error: "A face swap is already running." });
    const sources = (Array.isArray(req.body?.sources) ? req.body.sources : []).map(String).filter((p: string) => IMAGE_RE.test(p) && exists(p));
    const target = String(req.body?.target || "");
    if (!sources.length) return res.status(400).json({ error: "Pick at least one photo of the face to use." });
    if (!(IMAGE_RE.test(target) || VIDEO_RE.test(target)) || !exists(target)) return res.status(400).json({ error: "Pick the picture or video to put the face on." });
    const swappers = models(SWAPPERS), enhancers = models(ENHANCERS);
    const model = swappers.includes(req.body?.model) ? req.body.model : swappers[0];
    if (!model) return res.status(400).json({ error: "No face swap model in faceswap/facefusion/.assets/models." });
    const enhancer = enhancers.includes(req.body?.enhancer) ? req.body.enhancer : undefined;
    fs.mkdirSync(outDir, { recursive: true });
    const output = path.join(outDir, `faceswap_${path.parse(target).name.replace(/[^\w-]+/g, "_").slice(0, 40)}_${Date.now()}${path.extname(target).toLowerCase()}`);
    const lines: string[] = [];
    await freeVram(opts, t => lines.push(t));
    const state = startProcess("faceswap", `Face swap onto ${path.basename(target)}`, python,
      buildFaceSwapArgs({ sources, target, output, model, enhancer, allFaces: !!req.body?.allFaces, ffDir, script }),
      { cwd: ffDir, onExit: (code, job) => { if (code === 0 && exists(output)) job.result = { output }; } });
    res.json({ ok: true, state, output, notes: lines });
  });

  app.post("/api/train/faceswap/stop", (_req, res) => res.json({ ok: stopJob("faceswap") }));

  /** Opens outputs/faceswap in the file manager. */
  app.post("/api/faceswap/open-folder", (_req, res) => {
    fs.mkdirSync(outDir, { recursive: true });
    const cmd = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
    spawn(cmd, [outDir], { detached: true, stdio: "ignore" }).unref();
    res.json({ ok: true });
  });

  /** Shows a picture or video picked for (or made by) a face swap. */
  app.get("/api/faceswap/media", (req, res) => {
    const file = path.resolve(String(req.query.path || ""));
    if (!(IMAGE_RE.test(file) || VIDEO_RE.test(file)) || !exists(file)) return res.status(404).json({ error: "No such file." });
    const type = MIME[path.extname(file).toLowerCase()];
    if (type) res.type(type);
    res.sendFile(file);
  });
}
