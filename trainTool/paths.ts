/**
 * Where the training tools live on this PC. The heavy parts (FluxGym with kohya sd-scripts, the Unsloth virtual environment, base models)
 * stay where they were set up; this app drives them. Every path can be changed in the page and is saved in config.json.
 */
import fs from "fs";
import path from "path";

export interface TrainConfig {
  /** The folder that holds llm_finetune/ (the Unsloth venv, models, datasets, outputs). */
  trainRoot?: string;
  /** FluxGym's folder (kohya sd-scripts, its venv, Flux weights). */
  fluxgymRoot?: string;
}

const DEFAULT_TRAIN_ROOT = "D:\\Claude\\In_Progress\\Before_The_Dragons\\Train_LORA";
const DEFAULT_FLUXGYM = "C:\\pinokio\\api\\fluxgym.git";

export interface TrainPaths {
  trainRoot: string;
  fluxgymRoot: string;
  llmRoot: string;
  llmPython: string;
  llmModelsDir: string;
  llmDatasetsDir: string;
  llmOutputDir: string;
  fluxPython: string;
  fluxAccelerate: string;
  sdScripts: string;
  fluxUnet: string;
  fluxClipL: string;
  fluxT5: string;
  fluxVae: string;
  fluxDatasetsDir: string;
  fluxOutputDir: string;
  fluxUnetDir: string;
  scriptsDir: string;
  speechRoot: string;
  speechDatasetsDir: string;
  speechModelsDir: string;
  speechOutputDir: string;
  /** Python environment for text-to-speech training (coqui-tts), made by the Train Speech page. */
  ttsPython: string;
}

export function resolvePaths(cfg: TrainConfig, appRoot: string): TrainPaths {
  // The app's own train/ folder (Python environment, base models, datasets, outputs) wins; the old folder is only a fallback.
  const own = path.join(appRoot, "train");
  const trainRoot = cfg.trainRoot || (fs.existsSync(path.join(own, "llm_finetune")) || !fs.existsSync(DEFAULT_TRAIN_ROOT) ? own : DEFAULT_TRAIN_ROOT);
  const fluxgymRoot = cfg.fluxgymRoot || DEFAULT_FLUXGYM;
  const llmRoot = path.join(trainRoot, "llm_finetune");
  const win = process.platform === "win32";
  const py = (root: string) => path.join(root, "env", win ? "Scripts" : "bin", win ? "python.exe" : "python");
  return {
    trainRoot, fluxgymRoot, llmRoot,
    llmPython: py(llmRoot),
    llmModelsDir: path.join(llmRoot, "models"),
    llmDatasetsDir: path.join(llmRoot, "datasets"),
    llmOutputDir: path.join(llmRoot, "outputs"),
    fluxPython: py(fluxgymRoot),
    fluxAccelerate: path.join(fluxgymRoot, "env", win ? "Scripts" : "bin", win ? "accelerate.exe" : "accelerate"),
    sdScripts: path.join(fluxgymRoot, "sd-scripts"),
    fluxUnet: path.join(fluxgymRoot, "models", "unet", "flux1-dev.sft"),
    fluxClipL: path.join(fluxgymRoot, "models", "clip", "clip_l.safetensors"),
    fluxT5: path.join(fluxgymRoot, "models", "clip", "t5xxl_fp16.safetensors"),
    fluxVae: path.join(fluxgymRoot, "models", "vae", "ae.sft"),
    fluxDatasetsDir: path.join(fluxgymRoot, "datasets"),
    fluxOutputDir: path.join(fluxgymRoot, "outputs"),
    fluxUnetDir: path.join(fluxgymRoot, "models", "unet"),
    scriptsDir: path.join(appRoot, "trainTool", "scripts"),
    speechRoot: path.join(trainRoot, "speech"),
    speechDatasetsDir: path.join(trainRoot, "speech", "datasets"),
    speechModelsDir: path.join(trainRoot, "speech", "models"),
    speechOutputDir: path.join(trainRoot, "speech", "outputs"),
    ttsPython: py(path.join(trainRoot, "speech", "tts")),
  };
}

export const exists = (p: string) => { try { return fs.existsSync(p); } catch { return false; } };

export function listDirs(dir: string): string[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
}

export function listFiles(dir: string, exts: string[]): { name: string; path: string; bytes: number }[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isFile() && exts.some(e => d.name.toLowerCase().endsWith(e)))
      .map(d => ({ name: d.name, path: path.join(dir, d.name), bytes: fs.statSync(path.join(dir, d.name)).size }));
  } catch { return []; }
}

/** A folder with a config.json at its root is a real downloaded Hugging Face model. */
export function listHfModels(dir: string): { name: string; path: string }[] {
  return listDirs(dir).filter(n => exists(path.join(dir, n, "config.json"))).map(n => ({ name: n, path: path.join(dir, n) }));
}
